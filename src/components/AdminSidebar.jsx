import TabGroup from './ui/TabGroup';
import './AdminSidebar.css';

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview' },
  { id: 'bookings', label: 'Booking Management' },
  { id: 'cameras', label: 'Manage Camera' },
];

export default function AdminSidebar({ activeTab, onSelect }) {
  return (
    <TabGroup
      as="aside"
      className="admin-sidebar"
      items={NAV_ITEMS}
      activeId={activeTab}
      onSelect={onSelect}
      itemClassName="admin-sidebar-item"
    />
  );
}
