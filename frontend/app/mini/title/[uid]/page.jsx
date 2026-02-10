import { redirect } from 'next/navigation';

export default function MiniTitleAlias({ params, searchParams }) {
  const uid = encodeURIComponent(String(params?.uid || ''));
  const qs = new URLSearchParams(searchParams || {}).toString();
  redirect(qs ? `/title/${uid}?${qs}` : `/title/${uid}`);
}

