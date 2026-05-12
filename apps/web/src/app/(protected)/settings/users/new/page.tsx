/**
 * /settings/users/new — server wrapper.
 */
import NewUserClient from './NewUserClient';

export const dynamic = 'force-dynamic';

export default function NewUserPage() {
  return <NewUserClient />;
}
