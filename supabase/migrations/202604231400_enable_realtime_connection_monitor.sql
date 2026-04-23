-- Enable Supabase Realtime for connection monitoring tables
-- This allows the frontend ConnectionMonitor to receive live updates

-- Add px_connections to the realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.px_connections;

-- Add px_tenants to the realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.px_tenants;
