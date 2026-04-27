import PlexusDashboard from './components/Dashboard';
import MonitorPage from './components/MonitorPage';

function App() {
  const path = window.location.pathname;
  if (path === '/monitor' || path === '/monitor/') {
    return <MonitorPage />;
  }
  return <PlexusDashboard />;
}

export default App;
