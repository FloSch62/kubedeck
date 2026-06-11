import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import type { FavoriteItem, ResourceRef, SearchResult } from '@kubedeck/shared';
import { groupToPath } from '@kubedeck/shared';
import { useNavigate } from 'react-router';
import { useGlobalSearch } from '../api/queries.js';
import { useClustersStore } from '../state/clusters.js';
import { useNavigationStore } from '../state/navigation.js';

function pathForRef(ref: ResourceRef): string {
  return `/r/${groupToPath(ref.group)}/${ref.version}/${ref.plural}`;
}

function detailPathForRef(ref: ResourceRef): string {
  const sel = `${ref.ctx}|${ref.namespace ?? ''}|${ref.name}`;
  return `${pathForRef(ref)}?sel=${encodeURIComponent(sel)}`;
}

function favoriteFromResult(result: SearchResult): FavoriteItem {
  return {
    id: result.id,
    title: result.title,
    subtitle: result.subtitle,
    path: result.ref ? detailPathForRef(result.ref) : result.path,
    ref: result.ref,
  };
}

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const selected = useClustersStore((s) => s.selected);
  const [query, setQuery] = useState('');
  const { data: results, isFetching } = useGlobalSearch(selected, query);
  const favorites = useNavigationStore((s) => s.favorites);
  const addFavorite = useNavigationStore((s) => s.addFavorite);
  const removeFavorite = useNavigationStore((s) => s.removeFavorite);
  const isFavorite = useNavigationStore((s) => s.isFavorite);
  const navigate = useNavigate();

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const visible = useMemo(() => {
    if (query.trim().length > 1) return results ?? [];
    return favorites.map<SearchResult>((f) => ({
      id: f.id,
      kind: f.ref ? 'resource' : 'page',
      title: f.title,
      subtitle: f.subtitle,
      score: 1,
      ref: f.ref,
      path: f.path,
    }));
  }, [query, results, favorites]);

  const activate = (item: SearchResult) => {
    const path = item.ref ? detailPathForRef(item.ref) : item.path ?? '/';
    navigate(path);
    onClose();
  };

  const toggleFavorite = (item: SearchResult) => {
    if (isFavorite(item.id)) removeFavorite(item.id);
    else addFavorite(favoriteFromResult(item));
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogContent sx={{ p: 1.25 }}>
        <TextField
          autoFocus
          fullWidth
          placeholder="Search resources, pages, kinds…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && visible[0]) {
              e.preventDefault();
              activate(visible[0]);
            }
          }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 0.5, py: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {query.trim().length > 1 ? (isFetching ? 'Searching…' : `${visible.length} results`) : favorites.length ? 'Favorites' : 'Type at least 2 characters'}
          </Typography>
          {selected.length > 0 && <Chip size="small" label={`${selected.length} cluster${selected.length === 1 ? '' : 's'}`} variant="outlined" />}
        </Box>
        <List dense disablePadding sx={{ maxHeight: 440, overflow: 'auto' }}>
          {visible.map((item) => (
            <ListItemButton key={item.id} onClick={() => activate(item)} sx={{ borderRadius: 1 }}>
              <ListItemText
                primary={item.title}
                secondary={item.subtitle}
                slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
              />
              <Chip size="small" label={item.kind} variant="outlined" sx={{ mr: 0.5 }} />
              <Tooltip title={isFavorite(item.id) ? 'Remove favorite' : 'Add favorite'}>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavorite(item);
                  }}
                >
                  {isFavorite(item.id) ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            </ListItemButton>
          ))}
        </List>
      </DialogContent>
    </Dialog>
  );
}
