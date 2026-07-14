import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import CreateJob from './pages/CreateJob';
import JsonReview from './pages/JsonReview';
import ImageQueue from './pages/ImageQueue';
import Login from './pages/Login';
import Eligibility from './pages/Eligibility';
import Signup from './pages/Signup';
import ErrorLogs from './pages/ErrorLogs';
import BundleReview from './pages/BundleReview';
import Downloads from './pages/Downloads';
import Settings from './pages/Settings';
import Users from './pages/Users';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename="/productpipeline">
        <Routes>
          {/* Public Auth Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/eligibility" element={<Eligibility />} />
          <Route path="/signup" element={<Signup />} />
          
          {/* Protected Dashboard Routes */}
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="jobs/create" element={<CreateJob />} />
            
            <Route path="approvals/json" element={
              <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
                <JsonReview />
              </ProtectedRoute>
            } />
            <Route path="approvals/images" element={
              <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
                <ImageQueue />
              </ProtectedRoute>
            } />
            
            <Route path="bundles" element={
              <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
                <BundleReview />
              </ProtectedRoute>
            } />
            <Route path="downloads" element={<Downloads />} />
            <Route path="error-logs" element={
              <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
                <ErrorLogs />
              </ProtectedRoute>
            } />
            
            {/* Strict role-based protection */}
            <Route path="users" element={
              <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
                <Users />
              </ProtectedRoute>
            } />
            <Route path="settings" element={
              <ProtectedRoute allowedRoles={['superadmin']}>
                <Settings />
              </ProtectedRoute>
            } />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
