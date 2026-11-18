/**
 * Sidebar Component Library
 *
 * Re-exports all sidebar components from modularized files.
 * Previously a 727 LOC monolithic file, now split into:
 * - context.tsx: Provider, context, and hooks
 * - components.tsx: Main sidebar structure components
 * - menu.tsx: Menu-related components
 */

export { SidebarProvider, useSidebar } from "./context"
export {
  Sidebar,
  SidebarTrigger,
  SidebarRail,
  SidebarInset,
  SidebarInput,
  SidebarHeader,
  SidebarFooter,
  SidebarSeparator,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarProviderWithTooltip,
} from "./components"
export {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "./menu"
