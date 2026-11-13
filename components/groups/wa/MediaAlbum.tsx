'use client';

import { useState, type SyntheticEvent } from 'react';
import { useTranslations } from 'next-intl';
import { albumLayout } from '@/lib/wa-albums';
import { duration, posterFrame } from './format';
import { CameraIcon, Chevron, Play } from './icons';
import { longPress } from './longPress';
import { MessageMenu, type MenuItem } from './Menu';

/** Una foto o video del álbum, con las acciones de su propio mensaje. */
export interface AlbumTile {
  id: string;
  kind: 'image' | 'video';
  url: string;
  alt: string;
  thumbnail?: string;
  seconds?: number;
  menu: MenuItem[];
  selected?: boolean;
}

/**
 * Varias fotos o videos mandados juntos, en una grilla como la de WhatsApp
 * (lib/wa-albums.ts decide qué va junto y cómo se arma). Cada foto es su
 * mensaje: tocarla abre el visor en esa, el clic derecho o el toque largo
 * abre su menú, y en modo selección se elige sola. La burbuja (nombre, texto,
 * hora, reacciones) la pone quien lo usa.
 */
export default function MediaAlbum({
  tiles,
  onOpen,
  selecting,
  onSelect,
  menuLabel,
  align,
  onLoad,
}: {
  tiles: AlbumTile[];
  onOpen: (id: string) => void;
  selecting?: boolean;
  onSelect?: (id: string) => void;
  menuLabel: string;
  align: 'left' | 'right';
  onLoad?: (e: SyntheticEvent<HTMLImageElement>) => void;
}) {
  const t = useTranslations('groups');
  const { shape, shown, more } = albumLayout(tiles.length);
  const lastId = tiles.at(-1)?.id;
  return (
    <div className={`wa-album is-${shape}`} role="group" aria-label={t('wa.album', { n: tiles.length })} data-count={tiles.length}>
      {tiles.slice(0, shown).map((tile, i) => {
        const cover = more > 0 && i === shown - 1;
        const openMenu = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.wa-album-chevron')?.click();
        const hold = longPress(openMenu);
        return (
          <div
            key={tile.id}
            // La última es el mensaje de la burbuja (el artículo ya lleva su id); las demás, para ir a ellas desde una búsqueda o una cita.
            id={tile.id === lastId ? undefined : `m-${tile.id}`}
            className={`wa-album-tile${tile.selected ? ' is-selected' : ''}`}
            data-msg-id={tile.id}
            onContextMenu={(e) => {
              e.stopPropagation();
              if (selecting || !tile.menu.length) return;
              e.preventDefault();
              openMenu(e.currentTarget);
            }}
            {...hold}
            onPointerDown={(e) => {
              // El toque largo y el deslizar de la burbuja no corren sobre una foto: acá manda la foto.
              e.stopPropagation();
              if (!selecting) hold.onPointerDown(e);
            }}
          >
            <button
              type="button"
              className="wa-album-open"
              onClick={(e) => {
                e.stopPropagation();
                if (selecting) onSelect?.(tile.id);
                else onOpen(tile.id);
              }}
              aria-label={cover ? t('wa.albumMore', { n: more }) : tile.kind === 'video' ? t('wa.playVideo') : t('wa.openMedia', { name: tile.alt })}
              aria-pressed={selecting ? Boolean(tile.selected) : undefined}
            >
              <TileMedia tile={tile} onLoad={onLoad} />
              {tile.kind === 'video' && !cover && (
                <>
                  <span className="wa-video-play" aria-hidden="true">
                    <Play size={26} />
                  </span>
                  <span className="wa-album-video" aria-hidden="true">
                    <CameraIcon size={14} />
                    {tile.seconds ? duration(tile.seconds) : null}
                  </span>
                </>
              )}
              {cover && (
                <span className="wa-album-more" aria-hidden="true">
                  +{more}
                </span>
              )}
            </button>
            {selecting ? (
              <input type="checkbox" className="wa-select-check wa-album-check" checked={Boolean(tile.selected)} readOnly tabIndex={-1} aria-hidden="true" />
            ) : (
              tile.menu.length > 0 && (
                <span className="wa-album-hover">
                  <MessageMenu label={menuLabel} items={tile.menu} trigger={<Chevron size={18} />} className="wa-album-chevron" align={align} />
                </span>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

/** La foto (con la miniatura borrosa hasta que carga) o el primer cuadro del video. */
function TileMedia({ tile, onLoad }: { tile: AlbumTile; onLoad?: (e: SyntheticEvent<HTMLImageElement>) => void }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (tile.kind === 'video') {
    return tile.thumbnail ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={tile.thumbnail} alt="" aria-hidden="true" />
    ) : (
      <video src={posterFrame(tile.url)} preload="metadata" muted playsInline tabIndex={-1} aria-hidden="true" />
    );
  }
  return (
    <>
      {tile.thumbnail && !loaded && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="wa-thumb" src={tile.thumbnail} alt="" aria-hidden="true" />
      )}
      {!failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={tile.url}
          alt=""
          loading="lazy"
          className={tile.thumbnail && !loaded ? 'is-pending' : undefined}
          ref={(el) => {
            // Ya estaba en caché: terminó de cargar antes de que React escuchara onLoad.
            if (el?.complete && el.naturalWidth > 0 && !loaded) setLoaded(true);
          }}
          onLoad={(e) => {
            setLoaded(true);
            onLoad?.(e);
          }}
          onError={() => setFailed(true)}
        />
      )}
    </>
  );
}
