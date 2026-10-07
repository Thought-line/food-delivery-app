import { useContext } from 'react';
import { BookingNotificationsContext } from './bookingNotificationsState';
export function useBookingNotifications() {
  return useContext(BookingNotificationsContext);
}
