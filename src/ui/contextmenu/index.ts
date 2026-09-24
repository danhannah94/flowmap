// Context menus (UI40). Importing this mounts the menu and registers the built-in items. Features add behaviour for
// their items with `registerMenuHandler` (see registry.ts for how items work) and may use the sub-controls in
// controls.tsx.
import './items';
import './builtin';
import './ContextMenu';

export {
  defineMenuItem, hasMenuHandler, registerMenuHandler,
  type MenuContext, type MenuHandler, type MenuItemDef, type MenuOn, type MenuTarget,
} from './registry';
export {
  MenuColorFields, MenuNumberField, MenuShapeOptions,
  type MenuColorFieldSpec, type MenuSwatch,
} from './controls';
export { closeContextMenu } from './state';
