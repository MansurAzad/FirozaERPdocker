import { createFileRoute } from '@tanstack/react-router';
import { handleGuardianChat } from '@/lib/guardian/chat.server';
export const Route = createFileRoute('/api/guardian-chat')({ server: { handlers: { POST: ({ request }) => handleGuardianChat(request) } } });