import { useEffect, useState } from 'react';
import { AppShell } from './components/shell/AppShell';
import { HomePage } from './pages/HomePage';
import { InspectorPage } from './pages/InspectorPage';
import { useRoute } from './lib/router';
import { useServerHealth, useServers } from './lib/hooks';

export function App() {
  const [route, navigate] = useRoute();
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const { data: online = false } = useServerHealth();
  const { data: servers = [] } = useServers();

  // Auto-selecciona el primer servidor la primera vez que hay datos
  // y estamos en la ruta inspector.
  useEffect(() => {
    if (selectedServerId === null && servers.length > 0) {
      const first = servers[0];
      if (first) setSelectedServerId(first.config.id);
    }
  }, [servers, selectedServerId]);

  return (
    <AppShell online={online} currentRoute={route} onNavigate={navigate}>
      {route === 'home' ? (
        <HomePage
          onNavigate={navigate}
          onSelectServer={setSelectedServerId}
        />
      ) : (
        <InspectorPage
          selectedServerId={selectedServerId}
          onSelectServer={setSelectedServerId}
        />
      )}
    </AppShell>
  );
}
