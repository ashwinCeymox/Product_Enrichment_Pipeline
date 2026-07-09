import os
import aiohttp
from fastapi import APIRouter

router = APIRouter(prefix="/settings", tags=["Settings"])

@router.get("/credentials", summary="Get AI Tool Credentials")
def get_credentials():
    return {
        "deepseek": os.getenv("DEEPSEEK_API_KEY", ""),
        "nano_banana": os.getenv("NANO_BANANA_BEARER_TOKEN", ""),
        "serper": os.getenv("SERPER_API_KEY", ""),
        "openrouter": os.getenv("OPENROUTER_API_KEY", "")
    }

from pydantic import BaseModel
class CredentialsUpdate(BaseModel):
    deepseek: str | None = None
    openrouter: str | None = None
    serper: str | None = None

@router.post("/credentials", summary="Update AI Tool Credentials")
def update_credentials(payload: CredentialsUpdate):
    import dotenv
    env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")
    
    updates = {
        "DEEPSEEK_API_KEY": payload.deepseek,
        "OPENROUTER_API_KEY": payload.openrouter,
        "SERPER_API_KEY": payload.serper
    }
    
    for key, val in updates.items():
        if val is not None:
            if val == "":
                dotenv.unset_key(env_file, key)
                if key in os.environ:
                    del os.environ[key]
            else:
                # Update the file
                dotenv.set_key(env_file, key, val)
                # Update memory so it works instantly without a server restart
                os.environ[key] = val
            
    return {"status": "success", "message": "Credentials saved"}

@router.post("/verify/openrouter", summary="Verify OpenRouter Key")
async def verify_openrouter():
    key = os.getenv("OPENROUTER_API_KEY", "")
    if not key:
        return {"status": "error", "message": "Key not set"}
    async with aiohttp.ClientSession() as session:
        headers = {"Authorization": f"Bearer {key}"}
        async with session.get("https://openrouter.ai/api/v1/auth/key", headers=headers) as resp:
            if resp.status == 200:
                data = await resp.json()
                data_dict = data.get("data", {})
                label = data_dict.get("label", "Valid Key")
                limit = data_dict.get("limit")
                usage = data_dict.get("usage", 0)
                credits_remaining = None
                if limit is not None:
                    credits_remaining = round(limit - usage, 4)
                
                return {
                    "status": "success", 
                    "message": f"Verified ({label})",
                    "credits_remaining": f"${credits_remaining}" if credits_remaining is not None else "Unlimited / Pay-as-you-go"
                }
            else:
                return {"status": "error", "message": f"HTTP {resp.status}"}

@router.post("/verify/deepseek", summary="Verify Deepseek Key")
async def verify_deepseek():
    key = os.getenv("DEEPSEEK_API_KEY", "")
    if not key:
        return {"status": "error", "message": "Key not set"}
    async with aiohttp.ClientSession() as session:
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        async with session.get("https://api.deepseek.com/models", headers=headers) as resp:
            if resp.status == 200:
                return {"status": "success", "message": "Key is valid"}
            else:
                return {"status": "error", "message": f"HTTP {resp.status}"}

@router.post("/verify/serper", summary="Verify Serper Key")
async def verify_serper():
    key = os.getenv("SERPER_API_KEY", "")
    if not key:
        return {"status": "error", "message": "Key not set"}
    async with aiohttp.ClientSession() as session:
        headers = {"X-API-KEY": key, "Content-Type": "application/json"}
        payload = {"q": "test"}
        async with session.post("https://google.serper.dev/search", headers=headers, json=payload) as resp:
            if resp.status == 200:
                return {"status": "success", "message": "Key is valid"}
            else:
                return {"status": "error", "message": f"HTTP {resp.status}"}


