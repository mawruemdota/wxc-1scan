import { isAdmin } from '@/lib/auth';
import AdminDashboard from '@/components/AdminDashboard';
export const dynamic='force-dynamic';
export default async function AdminPage(){return <AdminDashboard initiallyAuthenticated={await isAdmin()}/>;}
