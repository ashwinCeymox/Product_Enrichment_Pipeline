import asyncio
import os
import uuid
import httpx
from app.celery_app import celery_app
from app.database import SessionLocal
from app.models.scrape_task import ScrapeTask
from app.models.image_asset import ImageAsset
from app.tasks.tools.img_prompt import generate_all_prompts
from app.tasks.tools.image_generator import generate_product_images

REFERENCE_IMAGE_CACHE = "output/reference_cache"
MAX_SCRAPED_IMAGES = int(os.getenv("MAX_SCRAPED_IMAGES", "6"))

async def download_reference_images(product: dict, job_id: str, max_images: int = MAX_SCRAPED_IMAGES) -> list[str]:
    paths = []
    try:
        images_val = product.get("images")
        if isinstance(images_val, dict):
            scraped = images_val.get("scraped_images", [])
        elif isinstance(images_val, list):
            scraped = images_val
        else:
            scraped = []
            
        # Normalize: if it's a list of strings, convert to dict format
        normalized_scraped = []
        for item in scraped:
            if isinstance(item, str):
                normalized_scraped.append({"url": item})
            elif isinstance(item, dict):
                normalized_scraped.append(item)
        scraped = normalized_scraped
            
        if not scraped: return paths
        
        job_cache_dir = os.path.join(REFERENCE_IMAGE_CACHE, job_id)
        os.makedirs(job_cache_dir, exist_ok=True)
        
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            for i, img in enumerate(scraped[:max_images]):
                url = img.get("url", "")
                if not url: continue
                
                ext = os.path.splitext(url.split("?")[0])[1] or ".jpg"
                save_path = os.path.join(job_cache_dir, f"ref_{uuid.uuid4().hex}{ext}")
                
                try:
                    response = await client.get(url)
                    response.raise_for_status()
                    with open(save_path, "wb") as f:
                        f.write(response.content)
                    paths.append(save_path)
                except Exception as e:
                    print(f"Failed to download ref image {url}: {e}")
                    
        return paths
    except Exception as e:
        print(f"Ref images download failed: {e}")
        return paths

async def _run_image_pipeline(job_id: str):
    db = SessionLocal()
    try:
        job = db.query(ScrapeTask).filter(ScrapeTask.id == job_id).first()
        if not job or not job.product_data:
            return
            
        if job.status in ["success", "aborted", "waiting_for_approval", "completed"]:
            return
            
        product = job.product_data
        base_sku = product.get("product_identity", {}).get("sku", job.task_name)
        # Ensure 100% filesystem isolation for this specific task
        sku = f"{base_sku}_{job.id}"
        
        # 1. Download Reference Images
        ref_image_paths = await download_reference_images(product, str(job.id))
        
        # 2. Generate Prompts (DeepSeek)
        prompt_results = await generate_all_prompts(product)
        if not prompt_results["lifestyle"] and not prompt_results["features"]:
            raise Exception("Failed to generate any image prompts. Check LLM (DeepSeek) configuration and API keys.")
        
        def check_cancel():
            db.refresh(job)
            return job.status in ["image_generation_stopped", "success", "aborted", "waiting_for_approval", "failed"]
        
        def on_image_generated(group_type: str, index: int, prompt: str, img_data: dict, title: str = None):
            var_group = f"lifestyle_{index+1}" if group_type == "lifestyle" else f"feature_{index+1}"
            asset_name = f"Lifestyle-{index+1}.png" if group_type == "lifestyle" else f"Feature-{title.replace(' ', '')}.png"
            
            # Check if an asset for this variation_group already exists (e.g. from a resumed or retried job)
            existing = db.query(ImageAsset).filter(
                ImageAsset.scrape_task_id == job.id,
                ImageAsset.variation_group == var_group,
                ~ImageAsset.asset_name.like("%-regenerated%") # Only overwrite base images, not regenerated ones
            ).first()
            
            if existing:
                existing.asset_name = asset_name
                existing.storage_path = img_data["path"]
                existing.prompt_text = prompt
                existing.status = "pending"
            else:
                asset = ImageAsset(
                    scrape_task_id=job.id,
                    asset_name=asset_name,
                    storage_path=img_data["path"],
                    prompt_text=prompt,
                    variation_group=var_group,
                    status="pending"
                )
                db.add(asset)
            db.commit()
            
        # 3. Generate Images (OpenRouter Gemini Nano Banana)
        image_results = await generate_product_images(
            lifestyle_prompts=prompt_results["lifestyle"],
            feature_prompts=prompt_results["features"],
            product_sku=sku,
            reference_image_paths=ref_image_paths,
            check_cancel_cb=check_cancel,
            on_image_generated_cb=on_image_generated
        )
        
        db.refresh(job)
        if job.status not in ["image_generation_stopped", "aborted", "waiting_for_approval", "failed"]:
            job.status = "image_generation_complete"
        db.commit()
        
    except Exception as e:
        error_str = str(e)
        print(f"Error in image pipeline: {error_str}")
        
        # Issue 1: Cleanup temporary files and partial DB records on unexpected failure
        try:
            db.query(ImageAsset).filter(ImageAsset.scrape_task_id == job.id).delete()
            from app.routers.images import cleanup_job_files
            cleanup_job_files(str(job.id), db)
        except Exception as cleanup_err:
            print(f"Failed to cleanup after error: {cleanup_err}")
        
        # Detect specific credit exhaustion from OpenRouter (402)
        if "402" in error_str and "Insufficient credits" in error_str:
            job.status = "image_generation_failed"
            job.error_message = "CREDITS_EXHAUSTED: OpenRouter API credits have been exhausted. Please top up at https://openrouter.ai/settings/credits"
        else:
            job.status = "image_generation_failed"
            job.error_message = error_str
        db.commit()
    finally:
        db.close()

@celery_app.task(bind=True, name="app.tasks.gen_images.generate_images_task")
def generate_images_task(self, job_id: str):
    """Generate image variations via Nano Banana for each asset slot."""
    asyncio.run(_run_image_pipeline(job_id))
    return f"Image generation finished for {job_id}"

@celery_app.task(bind=True, name="app.tasks.gen_images.regenerate_asset_task")
def regenerate_asset_task(self, target_asset_id: str, reference_asset_id: str = None):
    """Regenerate a single image asset using an isolated reference image."""
    from app.tasks.tools.image_generator import _generate_single_image
    import uuid
    import asyncio
    db = SessionLocal()
    try:
        target_asset = db.query(ImageAsset).filter(ImageAsset.id == target_asset_id).first()
        if not target_asset: return
        job = db.query(ScrapeTask).filter(ScrapeTask.id == target_asset.scrape_task_id).first()
        product = job.product_data if job else {}
        sku = product.get("product_identity", {}).get("sku", "unknown")
        
        # Grab original scraped images from the reference cache to preserve the product's true features.
        ref_image_paths = []
        job_id_str = str(job.id) if job else str(target_asset.scrape_task_id)
        job_cache_dir = os.path.join(REFERENCE_IMAGE_CACHE, job_id_str)
        
        if os.path.exists(job_cache_dir):
            for filename in os.listdir(job_cache_dir):
                file_path = os.path.join(job_cache_dir, filename)
                if os.path.isfile(file_path):
                    ref_image_paths.append(file_path)
                    
        # Sort and limit to ensure consistent order and avoid exceeding limits
        ref_image_paths.sort()
        ref_image_paths = ref_image_paths[:MAX_SCRAPED_IMAGES]
            
        try:
            url, cost = asyncio.run(_generate_single_image(
                prompt=target_asset.prompt_text,
                reference_image_paths=ref_image_paths,
                save_path=target_asset.storage_path
            ))
            target_asset.status = "success" # Set to success upon successful generation
            url_path = "/images/" + os.path.basename(target_asset.storage_path)
            target_asset.url = url_path
        except Exception as e:
            print(f"Error regenerating asset: {e}")
            target_asset.status = "failed"
            target_asset.error_message = str(e)
            
        db.commit()
    finally:
        db.close()
    return f"Regenerated asset {target_asset_id}"
