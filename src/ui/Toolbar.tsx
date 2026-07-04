import type { GameMode } from "./types.ts";
import { classNames } from "./utils.ts";

type ToolbarProps = {
  strategies: string[];
  selectedStrategy: string;
  gameMode: GameMode;
  soundEnabled: boolean;
  isResolving: boolean;
  canUndo: boolean;
  showStrategySelector: boolean;
  onNewDeal: () => void;
  onSelectedStrategyChange: (strategy: string) => void;
  onUndo: () => void;
  onGameModeChange: (mode: GameMode) => void;
  onSoundEnabledChange: (enabled: boolean) => void;
};

const controlInputClass =
  "h-[38px] rounded-md border-2 border-[#c18443] bg-[#3b0b14] text-[#ffd99b] disabled:cursor-wait";
const compactSelectClass = classNames(controlInputClass, "w-[min(100%,240px)] min-w-0 px-2 font-extrabold");
const controlButtonClass =
  "inline-grid h-[38px] w-[180px] shrink-0 cursor-pointer place-items-center rounded-md border-2 border-[#c18443] bg-gradient-to-b from-[#8c3a1e] to-[#5d1715] px-3.5 font-extrabold text-[#ffd99b] no-underline disabled:cursor-wait";
const fieldsetClass =
  "relative m-0 inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md border-2 border-[#c18443] bg-[#3b0b14] p-[3px] disabled:cursor-wait";
const modeFieldsetClass = classNames(fieldsetClass, "w-max");
const soundFieldsetClass = classNames(fieldsetClass, "w-max");
const fieldsetLegendClass = "absolute -top-3 left-2 bg-[#21110d] px-1 text-xs uppercase text-[#f2c389]";
const toggleLabelBaseClass =
  "relative inline-grid min-h-7 cursor-pointer place-items-center rounded px-2.5 text-xs font-extrabold text-[#ffd99b]";
const toggleLabelActiveClass = "bg-gradient-to-b from-[#8c3a1e] to-[#5d1715] text-[#ffe4b5]";
const toggleLabelDisabledClass = "cursor-wait";
const visuallyHiddenInputClass = "pointer-events-none absolute opacity-0";

export function Toolbar({
  strategies,
  selectedStrategy,
  gameMode,
  soundEnabled,
  isResolving,
  canUndo,
  showStrategySelector,
  onNewDeal,
  onSelectedStrategyChange,
  onUndo,
  onGameModeChange,
  onSoundEnabledChange,
}: ToolbarProps): JSX.Element {
  return (
    <section
      className="mx-auto flex w-full max-w-[1600px] flex-nowrap items-end justify-start gap-3 overflow-x-auto px-3 py-2.5 min-[761px]:justify-center"
      aria-label="Canvas controls"
    >
      <button className={controlButtonClass} type="button" disabled={isResolving} onClick={onNewDeal}>
        New Deal
      </button>
      {showStrategySelector && (
        <div className="w-[240px] shrink-0">
          <select
            aria-label="Deal strategy"
            className={compactSelectClass}
            value={selectedStrategy}
            disabled={isResolving}
            onChange={(event) => onSelectedStrategyChange(event.target.value)}
          >
            <optgroup label="Deal strategies">
              {strategies.map((strategy) => (
                <option key={strategy} value={strategy}>
                  {strategy}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      )}
      <button className={controlButtonClass} type="button" disabled={isResolving || !canUndo} onClick={onUndo}>
        Undo
      </button>
      <fieldset className={modeFieldsetClass} disabled={isResolving}>
        <legend className={fieldsetLegendClass}>Mode</legend>
        <label
          className={classNames(
            toggleLabelBaseClass,
            gameMode === "single-card" && toggleLabelActiveClass,
            isResolving && toggleLabelDisabledClass,
          )}
        >
          <input
            className={visuallyHiddenInputClass}
            type="radio"
            name="game-mode"
            value="single-card"
            checked={gameMode === "single-card"}
            onChange={() => onGameModeChange("single-card")}
          />
          <span>Single card</span>
        </label>
        <label
          className={classNames(
            toggleLabelBaseClass,
            gameMode === "entire-stack" && toggleLabelActiveClass,
            isResolving && toggleLabelDisabledClass,
          )}
        >
          <input
            className={visuallyHiddenInputClass}
            type="radio"
            name="game-mode"
            value="entire-stack"
            checked={gameMode === "entire-stack"}
            onChange={() => onGameModeChange("entire-stack")}
          />
          <span>Entire stack</span>
        </label>
      </fieldset>
      <fieldset className={soundFieldsetClass}>
        <legend className={fieldsetLegendClass}>Sound</legend>
        <label className={classNames(toggleLabelBaseClass, soundEnabled && toggleLabelActiveClass)}>
          <input
            className={visuallyHiddenInputClass}
            type="radio"
            name="sound-enabled"
            value="on"
            checked={soundEnabled}
            onChange={() => onSoundEnabledChange(true)}
          />
          <span>On</span>
        </label>
        <label className={classNames(toggleLabelBaseClass, !soundEnabled && toggleLabelActiveClass)}>
          <input
            className={visuallyHiddenInputClass}
            type="radio"
            name="sound-enabled"
            value="off"
            checked={!soundEnabled}
            onChange={() => onSoundEnabledChange(false)}
          />
          <span>Off</span>
        </label>
      </fieldset>
    </section>
  );
}
