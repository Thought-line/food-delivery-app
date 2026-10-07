import { useContext } from 'react';
import { AdminNotificationsContext } from './adminNotificationsState';

export function useAdminNotifications() {
  return useContext(AdminNotificationsContext);
}
