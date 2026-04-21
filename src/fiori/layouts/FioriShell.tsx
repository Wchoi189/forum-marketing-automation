import '@ui5/webcomponents-react/styles.css';
import { ThemeProvider, ShellBar, SideNavigation, SideNavigationItem, FlexBox } from '@ui5/webcomponents-react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';

// Import required UI5 icons
import '@ui5/webcomponents-icons/dist/home.js';
import '@ui5/webcomponents-icons/dist/activity-items.js';

const NAV_ITEMS: { text: string; icon: string; route: string }[] = [
  { text: 'Overview',       icon: 'home',           route: '/fiori' },
  { text: 'Publisher Runs', icon: 'activity-items', route: '/fiori/publisher-runs' },
];

export default function FioriShell() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <ThemeProvider>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <ShellBar
          primaryTitle="Marketing Automation"
          secondaryTitle="Fiori Dashboard (experiment)"
        />
        <FlexBox style={{ flex: 1, overflow: 'hidden' }}>
          <SideNavigation
            style={{ height: '100%', flexShrink: 0 }}
            onSelectionChange={(e) => {
              const label = (e.detail.item as HTMLElement & { text?: string }).text;
              const match = NAV_ITEMS.find((n) => n.text === label);
              if (match) navigate(match.route);
            }}
          >
            {NAV_ITEMS.map((item) => (
              <SideNavigationItem
                key={item.route}
                text={item.text}
                icon={item.icon}
                selected={
                  item.route === '/fiori'
                    ? location.pathname === '/fiori' || location.pathname === '/fiori/'
                    : location.pathname.startsWith(item.route)
                }
              />
            ))}
          </SideNavigation>
          <div style={{ flex: 1, overflow: 'auto', padding: '1.5rem', background: 'var(--sapBackgroundColor)' }}>
            <Outlet />
          </div>
        </FlexBox>
      </div>
    </ThemeProvider>
  );
}
