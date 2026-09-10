/**
 * App icon set: Hugeicons free tier (stroke), wrapped so views import
 * semantic names from one place — same pattern as the dashboard. Size via
 * className (e.g. size-4) or the `size` prop; colour follows currentColor.
 * Brand marks (Shard, GitHub) stay hand-drawn.
 */
import { HugeiconsIcon } from "@hugeicons/react";
import {
  BrowserIcon,
  Route01Icon,
  ShoppingCart01Icon,
  FingerPrintIcon,
  Settings01Icon,
  Copy01Icon,
  BookOpen01Icon,
  AppleIcon,
  WindowsNewIcon,
  TerminalIcon,
  PinIcon,
  Search01Icon,
  Download04Icon,
  Upload04Icon,
  Sun01Icon,
  Moon02Icon,
  ViewIcon,
  ViewOffSlashIcon,
  Key01Icon,
  Edit02Icon,
  ArrowReloadHorizontalIcon,
  PlusSignIcon,
  Folder01Icon,
  InformationCircleIcon,
  ArrowDown01Icon,
  Delete02Icon,
  Globe02Icon,
  Clock01Icon,
  Building02Icon,
  PlayIcon as HugePlayIcon,
  StopIcon as HugeStopIcon,
  MoreVerticalIcon,
  Link04Icon,
  PauseIcon as HugePauseIcon,
  SparklesIcon,
  StarIcon,
  LockIcon,
  PuzzleIcon,
  Bookmark02Icon,
  Delete03Icon,
  ArchiveRestoreIcon,
  FilterIcon as HugeFilterIcon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import type { ComponentProps } from "react";

type HugeiconsIconProps = ComponentProps<typeof HugeiconsIcon>;
type IconProps = Omit<HugeiconsIconProps, "icon">;

const make = (icon: HugeiconsIconProps["icon"]) =>
  function AppIcon(props: IconProps) {
    return <HugeiconsIcon icon={icon} strokeWidth={1.8} {...props} />;
  };

/* ── Navigation / section icons ── */
export const NavBrowsersIcon = make(BrowserIcon);
export const NavProxiesIcon = make(Route01Icon);
export const NavShopIcon = make(ShoppingCart01Icon);
export const NavFingerprintsIcon = make(FingerPrintIcon);
export const NavSettingsIcon = make(Settings01Icon);
export const DocsIcon = make(BookOpen01Icon);
export const NavPatchLogIcon = make(SparklesIcon);
export const NavExtensionsIcon = make(PuzzleIcon);
export const NavBookmarksIcon = make(Bookmark02Icon);
export const NavTrashIcon = make(Delete03Icon);

/* ── OS logos ── */
export const AppleOsIcon = make(AppleIcon);
export const WindowsOsIcon = make(WindowsNewIcon);
export const LinuxOsIcon = make(TerminalIcon);

/* ── Actions / affordances ── */
export const RouteIcon = make(Route01Icon);
export const SearchIcon = make(Search01Icon);
export const CopyIcon = make(Copy01Icon);
export const DownloadIcon = make(Download04Icon);
export const UploadIcon = make(Upload04Icon);
export const SunIcon = make(Sun01Icon);
export const MoonIcon = make(Moon02Icon);
export const EyeIcon = make(ViewIcon);
export const EyeOffIcon = make(ViewOffSlashIcon);
export const KeyIcon = make(Key01Icon);
export const EditIcon = make(Edit02Icon);
export const RefreshIcon = make(ArrowReloadHorizontalIcon);
export const AddIcon = make(PlusSignIcon);
export const FolderIcon = make(Folder01Icon);
export const InfoIcon = make(InformationCircleIcon);
export const StarOutlineIcon = make(StarIcon);
export const LockedIcon = make(LockIcon);
export const ChevronDownIcon = make(ArrowDown01Icon);
export const DeleteIcon = make(Delete02Icon);
export const GlobeIcon = make(Globe02Icon);
export const ClockIcon = make(Clock01Icon);
export const BuildingIcon = make(Building02Icon);
export const PinIconApp = make(PinIcon);
export const PlayIcon = make(HugePlayIcon);
export const StopIcon = make(HugeStopIcon);
export const MoreIcon = make(MoreVerticalIcon);
export const SyncIcon = make(Link04Icon);
export const RestoreIcon = make(ArchiveRestoreIcon);
export const FilterIcon = make(HugeFilterIcon);
export const CloseIcon = make(Cancel01Icon);
export const PauseIcon = make(HugePauseIcon);

export function ShardLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4.5" fill="currentColor" fillOpacity="0.25" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <path d="M12 2.5V5M12 19V21.5M2.5 12H5M19 12H21.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function ShardMini() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" fill="currentColor" />
    </svg>
  );
}

export function GithubMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
