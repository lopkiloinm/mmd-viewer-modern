import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, Square, Settings2, Hash, Timer, Target } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

export interface TimelineTrack {
  id: string;
  label: string;
  subtitle: string;
  startFrame: number;
  endFrame: number;
  active: boolean;
  accentClassName?: string;
}

interface TimelinePanelProps {
  currentFrame: number;
  maxFrame: number;
  fps: number;
  isPlaying: boolean;
  tracks: TimelineTrack[];
  disabled?: boolean;
  onTogglePlay: () => void;
  onStop: () => void;
  onFrameChange: (frame: number) => void;
  onStepFrame: (delta: number) => void;
  onFpsChange: (fps: number) => void;
  onMaxFrameChange: (frame: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}

const pickMajorStep = (maxFrame: number) => {
  const target = Math.max(1, maxFrame / 10);
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  return steps.find((step) => step >= target) ?? Math.ceil(target / 1000) * 1000;
};

export const TimelinePanel: React.FC<TimelinePanelProps> = ({
  currentFrame,
  maxFrame,
  fps,
  isPlaying,
  tracks,
  disabled = false,
  onTogglePlay,
  onStop,
  onFrameChange,
  onStepFrame,
  onFpsChange,
  onMaxFrameChange,
  onScrubStart,
  onScrubEnd,
}) => {
  const [isScrubbing, setIsScrubbing] = useState(false);
  const rulerRef = useRef<HTMLDivElement | null>(null);

  const clampedFrame = Math.min(Math.max(currentFrame, 0), Math.max(maxFrame, 0));
  const roundedFrame = Math.round(clampedFrame);
  const playheadPercent = maxFrame > 0 ? (clampedFrame / maxFrame) * 100 : 0;

  const majorStep = useMemo(() => pickMajorStep(Math.max(1, maxFrame)), [maxFrame]);
  const minorStep = majorStep / 4;
  const gridPercent = maxFrame > 0 ? (minorStep / maxFrame) * 100 : 0;
  
  const marks = useMemo(() => {
    const values: number[] = [];

    for (let frame = 0; frame <= maxFrame; frame += majorStep) {
      values.push(frame);
    }

    if (values[values.length - 1] !== maxFrame) {
      values.push(maxFrame);
    }

    return values;
  }, [majorStep, maxFrame]);

  const scrubToClientX = useCallback((clientX: number) => {
    const rect = rulerRef.current?.getBoundingClientRect();

    if (!rect || rect.width <= 0) {
      return;
    }

    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    onFrameChange(Math.round(ratio * maxFrame));
  }, [maxFrame, onFrameChange]);

  useEffect(() => {
    if (!isScrubbing) {
      return;
    }

    const previousUserSelect = document.body.style.userSelect;
    const previousWebkitUserSelect = document.body.style.webkitUserSelect;
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';

    const handlePointerMove = (event: PointerEvent) => {
      scrubToClientX(event.clientX);
    };

    const handlePointerUp = () => {
      onScrubEnd?.();
      setIsScrubbing(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      document.body.style.userSelect = previousUserSelect;
      document.body.style.webkitUserSelect = previousWebkitUserSelect;
    };
  }, [isScrubbing, onScrubEnd, scrubToClientX]);

  return (
    <div className="h-56 bg-[#121217] border-t border-[#272730] flex flex-col font-sans z-10 relative">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[#272730] bg-[#0c0c10]">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={onTogglePlay}
            disabled={disabled}
            className={`h-8 px-4 text-xs font-medium border-0 shadow-sm transition-all min-w-[80px] ${
              isPlaying 
                ? 'bg-amber-500 hover:bg-amber-400 text-amber-950' 
                : 'bg-violet-600 hover:bg-violet-500 text-white'
            }`}
          >
            {isPlaying ? (
              <><Pause className="mr-1.5 h-3.5 w-3.5 fill-current" /> Pause</>
            ) : (
              <><Play className="mr-1.5 h-3.5 w-3.5 fill-current" /> Play</>
            )}
          </Button>
          
          <div className="flex items-center gap-1 bg-[#1a1a24] p-1 rounded-md border border-[#272730]">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onStepFrame(-1)}
              disabled={disabled}
              className="h-6 px-2 text-xs hover:bg-[#272730] text-gray-300 hover:text-white"
              title="Previous Frame"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onStepFrame(1)}
              disabled={disabled}
              className="h-6 px-2 text-xs hover:bg-[#272730] text-gray-300 hover:text-white"
              title="Next Frame"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          
          <Button
            size="sm"
            variant="ghost"
            onClick={onStop}
            disabled={disabled && roundedFrame === 0}
            className="h-8 px-3 text-xs bg-[#1a1a24] hover:bg-red-500/10 text-gray-300 hover:text-red-400 border border-[#272730] transition-colors"
          >
            <Square className="mr-1.5 h-3.5 w-3.5 fill-current" />
            Stop
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-4 bg-[#1a1a24] px-3 py-1.5 rounded-md border border-[#272730]">
          <div className="flex items-center gap-2 group">
            <Hash className="w-3.5 h-3.5 text-gray-500 group-hover:text-violet-400 transition-colors" />
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Frame</span>
              <input
                type="number"
                min={0}
                max={Math.max(maxFrame, 0)}
                step={1}
                value={roundedFrame}
                className="h-6 w-16 rounded bg-[#121217] border border-[#272730] px-2 text-xs text-white font-mono focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none transition-all"
                onChange={(event) => onFrameChange(Number(event.target.value) || 0)}
              />
            </div>
          </div>
          
          <div className="w-px h-4 bg-[#272730]" />
          
          <div className="flex items-center gap-2 group">
            <Timer className="w-3.5 h-3.5 text-gray-500 group-hover:text-blue-400 transition-colors" />
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">FPS</span>
              <input
                type="number"
                min={1}
                max={120}
                step={1}
                value={fps}
                className="h-6 w-14 rounded bg-[#121217] border border-[#272730] px-2 text-xs text-white font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-all"
                onChange={(event) => onFpsChange(Number(event.target.value) || 30)}
              />
            </div>
          </div>
          
          <div className="w-px h-4 bg-[#272730]" />
          
          <div className="flex items-center gap-2 group">
            <Target className="w-3.5 h-3.5 text-gray-500 group-hover:text-emerald-400 transition-colors" />
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">End</span>
              <input
                type="number"
                min={1}
                step={1}
                value={Math.max(maxFrame, 1)}
                className="h-6 w-16 rounded bg-[#121217] border border-[#272730] px-2 text-xs text-white font-mono focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-all"
                onChange={(event) => onMaxFrameChange(Number(event.target.value) || 1)}
              />
            </div>
          </div>
          
          <div className="flex items-center bg-[#121217] px-2 py-1 rounded border border-[#272730]">
            <span className="text-xs font-mono text-violet-400">{(clampedFrame / Math.max(fps, 1)).toFixed(2)}s</span>
          </div>
        </div>
      </div>

      {/* Timeline Area */}
      <div className="flex-1 flex flex-col px-4 py-3 min-h-0 overflow-hidden bg-[#0c0c10]">
        <div className="flex flex-col flex-1 min-h-0 bg-[#121217] border border-[#272730] rounded-lg shadow-sm">
          
          {/* Header / Ruler Row */}
          <div 
            className="overflow-y-auto overflow-x-hidden bg-[#16161d] border-b border-[#272730] rounded-t-lg invisible-scrollbar" 
            style={{ scrollbarGutter: 'stable' }}
          >
            <div className="flex gap-4 px-3 py-3 h-11">
              <div className="w-[240px] flex items-center text-[10px] font-semibold uppercase tracking-widest text-gray-400 shrink-0">
                <Settings2 className="w-3.5 h-3.5 mr-1.5" />
                Timeline Tracks
              </div>
              <div className="flex-1 min-w-0 pr-[2px]">
                <div
                  ref={rulerRef}
                  className="relative h-full cursor-pointer overflow-hidden rounded bg-[#1a1a24] border border-[#32323e]"
                  onPointerDown={(event) => {
                    if (disabled) return;
                    event.preventDefault();
                    onScrubStart?.();
                    setIsScrubbing(true);
                    scrubToClientX(event.clientX);
                  }}
                >
                  {/* Grid lines */}
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px)',
                      backgroundSize: `${gridPercent}% 100%`,
                    }}
                  />
                  {/* Tick marks */}
                  {marks.map((mark) => {
                    const percent = maxFrame > 0 ? (mark / maxFrame) * 100 : 0;
                    // Don't show text for 0 to prevent overlap with start border
                    const showText = mark !== 0 || maxFrame < 100;
                    
                    return (
                      <div key={mark} className="absolute inset-y-0 pointer-events-none" style={{ left: `${percent}%` }}>
                        <div className="absolute bottom-0 left-0 w-[1px] h-2.5 bg-gray-500" />
                        {showText && (
                          <span className="absolute top-0 text-[10px] font-mono text-gray-400 font-medium tracking-tighter -translate-x-1/2">
                            {mark}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {/* Playhead */}
                  <div className="absolute inset-y-0 w-[1px] bg-violet-500 z-10" style={{ left: `${playheadPercent}%` }}>
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-violet-500 rounded-sm rotate-45" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Scrollable Tracks */}
          <div className="flex-1 overflow-y-auto min-h-0 rounded-b-lg" style={{ scrollbarGutter: 'stable' }}>
            <div className="flex gap-4 px-3 py-3">
              {/* Track Labels */}
              <div className="w-[240px] space-y-2 shrink-0">
                {tracks.length === 0 ? (
                  <div className="h-12 rounded-lg border border-dashed border-[#32323e] bg-[#16161d] px-3 flex items-center justify-center text-xs text-gray-500">
                    No tracks available
                  </div>
                ) : (
                  tracks.map((track) => (
                    <div
                      key={track.id}
                      className="h-12 rounded-lg border border-[#272730] bg-[#16161d] px-3 py-2 flex flex-col justify-center relative overflow-hidden group hover:border-gray-500/50 transition-colors"
                    >
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-violet-500/50" />
                      <div className="truncate text-xs font-semibold text-gray-200 ml-1.5">{track.label}</div>
                      <div className="truncate text-[10px] text-gray-500 mt-0.5 ml-1.5 flex items-center gap-1">
                        <div className={`w-1.5 h-1.5 rounded-full ${track.active ? 'bg-emerald-500' : 'bg-gray-600'}`} />
                        {track.subtitle}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Track Bars */}
              <div className="flex-1 space-y-2 min-w-0 pr-[2px]">
                {tracks.length === 0 ? (
                  <div className="h-12 rounded-lg border border-dashed border-[#32323e] bg-[#16161d] flex items-center justify-center text-xs text-gray-500">
                    Add characters to timeline
                  </div>
                ) : (
                  tracks.map((track) => {
                    const startPercent = maxFrame > 0 ? (track.startFrame / maxFrame) * 100 : 0;
                    const endPercent = maxFrame > 0 ? (track.endFrame / maxFrame) * 100 : 0;
                    const widthPercent = Math.max(endPercent - startPercent, track.active ? 0.75 : 0);

                    return (
                      <div
                        key={track.id}
                        className="relative h-12 cursor-pointer overflow-hidden rounded-lg border border-[#272730] bg-[#16161d] hover:bg-[#1a1a24] transition-colors"
                        onPointerDown={(event) => {
                          if (disabled) return;
                          event.preventDefault();
                          onScrubStart?.();
                          setIsScrubbing(true);
                          scrubToClientX(event.clientX);
                        }}
                      >
                        {/* Grid lines */}
                        <div
                          className="absolute inset-0 pointer-events-none"
                          style={{
                            backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px)',
                            backgroundSize: `${gridPercent}% 100%`,
                          }}
                        />
                        
                        {/* Track Background Pattern */}
                        <div className="absolute inset-0 opacity-10 pointer-events-none"
                          style={{
                            backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255,255,255,0.1) 10px, rgba(255,255,255,0.1) 20px)'
                          }}
                        />

                        {/* Clip bar */}
                        {track.active && track.endFrame > track.startFrame ? (
                          <div
                            className={cn(
                              'absolute inset-y-1.5 rounded-md border shadow-sm backdrop-blur-sm flex items-center overflow-hidden',
                              track.accentClassName || 'border-violet-500/50 bg-violet-500/20'
                            )}
                            style={{ left: `${startPercent}%`, width: `${widthPercent}%` }}
                          >
                            <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
                            <div className="truncate px-2 py-0.5 text-[10px] font-mono font-medium text-white drop-shadow-md z-10">
                              {track.endFrame - track.startFrame}f
                            </div>
                          </div>
                        ) : (
                          <div className="absolute inset-y-1.5 left-1 right-1 rounded-md border border-dashed border-[#32323e] bg-[#121217]/50 flex items-center justify-center">
                            <span className="text-[10px] font-medium text-gray-600">No motion data</span>
                          </div>
                        )}
                        {/* Playhead line */}
                        <div className="absolute inset-y-0 w-[1px] bg-violet-500/80 z-10 pointer-events-none" style={{ left: `${playheadPercent}%` }} />
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
