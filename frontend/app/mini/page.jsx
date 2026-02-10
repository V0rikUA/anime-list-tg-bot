import { redirect } from 'next/navigation';

export default function MiniAlias({ searchParams }) {
  const qs = new URLSearchParams(searchParams || {}).toString();
  redirect(qs ? `/?${qs}` : '/');
}

