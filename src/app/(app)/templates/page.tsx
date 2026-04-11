'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TemplateList } from '@/components/templates/TemplateList';
import { TemplateForm } from '@/components/templates/TemplateForm';

export default function TemplatesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = searchParams.get('slug');
  const isNew = searchParams.get('new') === '1';

  const handleSaved = useCallback(() => {
    router.push('/templates');
  }, [router]);

  if (isNew) {
    return <TemplateForm onSaved={handleSaved} />;
  }

  if (slug) {
    return <TemplateForm slug={slug} onSaved={handleSaved} />;
  }

  return (
    <div>
      <TemplateList />
    </div>
  );
}
