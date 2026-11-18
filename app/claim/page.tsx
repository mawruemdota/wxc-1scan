import ClaimForm from '@/components/ClaimForm';
export const dynamic='force-dynamic';
export default async function ClaimPage({ searchParams }:{searchParams:Promise<{key?:string}>}) {
  const {key}=await searchParams;
  return <ClaimForm passKey={typeof key==='string' ? key : ''}/>;
}
