import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
	process.env.NEXT_PUBLIC_SUPABASE_URL ||
	import.meta.env.VITE_SUPABASE_URL ||
	'';
const supabaseAnonKey =
	process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
	import.meta.env.VITE_SUPABASE_ANON_KEY ||
	'';

if (!supabaseUrl || !supabaseAnonKey) {
	console.error(
		'Missing Supabase env for frontend. Set NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY (or VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY).',
	);
}

export const supabase = createClient(
	supabaseUrl || 'https://invalid.local',
	supabaseAnonKey || 'invalid-anon-key',
);
