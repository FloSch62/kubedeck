import { useEffect, useState } from 'react';
import { AppBar, Box, IconButton, Stack, Toolbar, Tooltip, Typography } from '@mui/material';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import TerminalIcon from '@mui/icons-material/Terminal';
import SearchIcon from '@mui/icons-material/Search';
import { useClustersStore } from '../state/clusters.js';
import { useDockStore } from '../state/dock.js';
import { ClusterSwitcher } from './ClusterSwitcher.js';
import { NamespaceFilter } from './NamespaceFilter.js';
import { SearchDialog } from './SearchDialog.js';

export function TopBar() {
  const mode = useClustersStore((s) => s.themeMode);
  const toggleTheme = useClustersStore((s) => s.toggleTheme);
  const dock = useDockStore();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <AppBar position="static" color="transparent" sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar variant="dense" sx={{ gap: 1.5, minHeight: 52 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mr: 1.5 }}>
            <Box
              component="img"
              src="/kubedeck.svg"
              alt=""
              aria-hidden
              sx={{
                width: 30,
                height: 34,
                display: 'block',
                objectFit: 'contain',
              }}
            />
            <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: 0 }}>
              Kubedeck
            </Typography>
          </Stack>
          <ClusterSwitcher />
          <NamespaceFilter />
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Search (Ctrl+K)">
            <IconButton size="small" onClick={() => setSearchOpen(true)}>
              <SearchIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {dock.tabs.length > 0 && (
            <Tooltip title={dock.open ? 'Hide dock' : `Show dock (${dock.tabs.length} tabs)`}>
              <IconButton size="small" onClick={() => dock.setOpen(!dock.open)} color={dock.open ? 'primary' : 'default'}>
                <TerminalIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            <IconButton size="small" onClick={toggleTheme}>
              {mode === 'dark' ? <LightModeOutlinedIcon fontSize="small" /> : <DarkModeOutlinedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
