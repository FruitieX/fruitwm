import * as x11 from 'x11';
import R from 'ramda';
import * as keysym from 'keysym';
import { buildKeyMap, translateModifiers } from './util';

/* Constants */
const MOD_1_MASK = 1 << 3,
  GRAB_MODE_ASYNC = 1,
  NONE = 0;

const MODIFIER = 'alt';

const config = {
  keybindings: [
    { action: 'FOCUS_LEFT', key: 'h', modifier: [MODIFIER] },
    { action: 'FOCUS_RIGHT', key: 'l', modifier: [MODIFIER] },
    { action: 'FOCUS_UP', key: 'k', modifier: [MODIFIER] },
    { action: 'FOCUS_DOWN', key: 'j', modifier: [MODIFIER] },
    { action: 'CYCLE_WINDOWS', key: 'Tab', modifier: [MODIFIER] },
    { action: 'SPLIT_VERTICAL', key: 'o', modifier: [MODIFIER] },
    { action: 'SPLIT_HORIZONTAL', key: 'u', modifier: [MODIFIER] },
    { action: 'DESTROY_SPLIT', key: 'r', modifier: [MODIFIER] },
    { action: 'SPAWN_WORKSPACE', key: 'n', modifier: [MODIFIER] },
    { action: 'BREAK_CLIENT', key: 'n', modifier: [MODIFIER, 'shift'] },
  ],
};

interface Client {}

type Clients = { [wid: number]: Client };

interface ClientContainer {
  kind: 'client';
  id: number;
  parent?: SplitContainer;
  clients: Clients;
}

interface SplitContainer {
  kind: 'split';
  id: number;
  parent?: SplitContainer;
  left: Container;
  right: Container;
  size: number; // size of left split in percents
  horizontal: boolean;
}

type Container = SplitContainer | ClientContainer;
type Path = 'left' | 'right';

interface Workspace {
  tree: Container;
  activeContainerPath: Path[];
}

interface State {
  workspaces: Workspace[];
  activeWorkspace: number;
}

interface Dimensions {
  x: number;
  y: number;
  width: number;
  height: number;
}

let maxId = 0;
const createClientContainer = (
  clients?: Clients,
  parent?: SplitContainer,
): ClientContainer => ({
  kind: 'client',
  id: maxId++,
  parent,
  clients: clients || {},
});

const state: State = {
  workspaces: [
    {
      tree: createClientContainer(),
      activeContainerPath: [],
    },
  ],
  activeWorkspace: 0,
};

/* Globals */
var start: any, attr: any;

let X: any = null;
let root: any = null;
let ks2kc: any = [];

const activeContainerLens = (workspace: Workspace): R.Lens =>
  R.lensPath(workspace.activeContainerPath);

const getActiveContainer = (workspace: Workspace): ClientContainer =>
  R.view(activeContainerLens(workspace), workspace.tree);

const getActiveWorkspace = (state: State): Workspace =>
  state.workspaces[state.activeWorkspace];

const handleAction = (action: string) => {
  const activeWorkspace = getActiveWorkspace(state);
  const horizontal = action === 'SPLIT_HORIZONTAL';

  switch (action) {
    case 'FOCUS_LEFT':
      repositionWindows(activeWorkspace.tree, getScreenDimensions());
      break;
    case 'SPLIT_HORIZONTAL':
    case 'SPLIT_VERTICAL': {
      const container = splitContainer(
        getActiveContainer(activeWorkspace),
        horizontal,
      );

      activeWorkspace.tree = R.set(
        activeContainerLens(activeWorkspace),
        container,
        activeWorkspace.tree,
      );

      activeWorkspace.activeContainerPath.push('left');

      console.log('new tree:', activeWorkspace.tree);
      repositionWindows(activeWorkspace.tree, getScreenDimensions());
      break;
    }
    case 'DESTROY_SPLIT': {
      const container = getActiveContainer(activeWorkspace);

      // Can't destroy root container
      if (!container.parent) return;

      activeWorkspace.activeContainerPath.pop();

      const parent = mergeContainers(container.parent, container);

      activeWorkspace.tree = R.set(
        activeContainerLens(activeWorkspace),
        parent,
        activeWorkspace.tree,
      );

      console.log('new tree:', activeWorkspace.tree);
      repositionWindows(activeWorkspace.tree, getScreenDimensions());
      break;
    }
  }
};

const keyPressHandler = (event: any) => {
  config.keybindings.forEach(keybinding => {
    // Check if this is the binding which we are seeking.
    if (ks2kc[keysym.fromName(keybinding.key).keysym] === event.keycode) {
      let modMask = 0;

      keybinding.modifier.forEach(modifier => {
        modMask = modMask | translateModifiers(modifier);
      });

      if ((event.buttons & ~146) === modMask) {
        console.log('detected keypress for', keybinding);
        handleAction(keybinding.action);
      }
    }
  });
};

// Returns new parent
const mergeContainers = (
  parent: SplitContainer,
  container: ClientContainer,
): Container => {
  const otherContainer =
    parent.left.id === container.id ? parent.right : parent.left;
  const clients = container.clients;

  if (otherContainer.kind === 'split') {
    // Merge clients to leftmost ClientContainer in otherContainer, returning a SplitContainer
    const path = [];
    let subContainer = otherContainer.left;
    while (subContainer.kind !== 'client') {
      subContainer = subContainer.left;
      path.push('left');
    }

    path.push('clients');
    const clientContainerLens = R.lensPath(path);

    const left = R.over(
      clientContainerLens,
      (leafClients: Clients) => ({ ...leafClients, ...clients }),
      otherContainer.left,
    );

    return {
      kind: 'split',
      id: maxId++,
      parent: parent.parent,
      left,
      right: otherContainer.right,
      size: otherContainer.size,
      horizontal: otherContainer.horizontal,
    };
  } else {
    // Merge clients to otherContainer, returning a ClientContainer
    return {
      kind: 'client',
      id: maxId++,
      parent: parent.parent,
      clients: { ...otherContainer.clients, ...clients },
    };
  }
};

const splitContainer = (
  container: ClientContainer,
  horizontal: boolean,
): SplitContainer => {
  // if (container.kind === 'split') {
  //   throw new Error('Cannot split a container of type "split"');
  // }
  //
  const newContainer: SplitContainer = {
    kind: 'split',
    id: maxId++,
    parent: container.parent,
    size: 0.5,
    horizontal,
    left: container, // to make tsc happy
    right: container, // to make tsc happy
  };

  newContainer.left = createClientContainer(container.clients, newContainer);
  newContainer.right = createClientContainer(undefined, newContainer);

  return newContainer;
};

const repositionWindows = (container: Container, dims: Dimensions) => {
  if (container.kind === 'split') {
    const leftDims = { ...dims };
    const rightDims = { ...dims };

    if (container.horizontal) {
      leftDims.width -= Math.floor((1 - container.size) * dims.width);

      rightDims.x += Math.floor(container.size * dims.width);
      rightDims.width -= Math.floor(container.size * dims.width);
    } else {
      leftDims.height -= Math.floor((1 - container.size) * dims.height);

      rightDims.y += Math.floor(container.size * dims.height);
      rightDims.height -= Math.floor(container.size * dims.height);
    }

    repositionWindows(container.left, leftDims);
    repositionWindows(container.right, rightDims);
  } else {
    const clients = container.clients;
    Object.entries(clients).forEach(([wid, _client]) => {
      console.log('repositioning', wid, dims);
      X.MoveResizeWindow(wid, dims.x, dims.y, dims.width, dims.height);
    });
  }
};

const getScreenDimensions = (): Dimensions => ({
  x: 0,
  y: 0,
  width: X.display.screen[0].pixel_width,
  height: X.display.screen[0].pixel_height,
});

const traverseTree = (container: Container, fun: Function) => {
  if (container.kind === 'split') {
    traverseTree(container.left, fun);
    traverseTree(container.right, fun);
  }

  fun(container);
};

const unmanageWindow = (wid: number) => {
  state.workspaces.forEach(workspace =>
    traverseTree(workspace.tree, (container: Container) => {
      if (container.kind === 'client') {
        delete container.clients[wid];
      }
    }),
  );

  const activeWorkspace = state.workspaces[state.activeWorkspace];
  const rootContainer = activeWorkspace.tree;

  repositionWindows(rootContainer, getScreenDimensions());
};

const manageWindow = (wid: number) => {
  const activeWorkspace = getActiveWorkspace(state);
  const activeContainer = getActiveContainer(activeWorkspace);

  // if (activeContainer.kind === 'split') {
  //   throw new Error('The active container should never be of kind "split"');
  // }

  activeContainer.clients[wid] = {};

  const rootContainer = activeWorkspace.tree;
  repositionWindows(rootContainer, getScreenDimensions());

  X.MapWindow(wid);
};

x11
  .createClient((_err: any, display: any) => {
    X = display.client;
    root = X.display.screen[0].root;

    // this keycode crap is some hot X11 garbage
    var min_keycode = display.min_keycode;
    var max_keycode = display.max_keycode;
    X.GetKeyboardMapping(
      min_keycode,
      max_keycode - min_keycode,
      (_err: any, key_list: any) => {
        ks2kc = buildKeyMap(key_list, min_keycode);
      },
    );

    X.ChangeWindowAttributes(
      root,
      {
        eventMask:
          x11.eventMask.SubstructureRedirect | x11.eventMask.SubstructureNotify,
      },
      (err: any) => {
        if (err.error == 10) {
          console.error('Error: another window manager already running.');
          process.exit(1);
        }
      },
    );

    // Grab all keys from config
    config.keybindings.forEach(keybinding => {
      let modMask = 0;

      keybinding.modifier.forEach(modifier => {
        modMask = modMask | translateModifiers(modifier);
      });

      // Grab the key with each combination of capslock(2), numlock(16) and scrollock (128)
      [0, 2, 16, 18, 128, 130, 144, 146].forEach(combination =>
        X.GrabKey(
          display.screen[0].root,
          true,
          modMask | combination,
          keysym.fromName(keybinding.key),
          GRAB_MODE_ASYNC,
          GRAB_MODE_ASYNC,
        ),
      );
    });

    // Query existing windows
    X.QueryTree(root, (_err: any, tree: any) => {
      tree.children.forEach(manageWindow);
    });

    X.GrabButton(
      display.screen[0].root,
      true,
      x11.eventMask.ButtonPress |
        x11.eventMask.ButtonRelease |
        x11.eventMask.PointerMotion,
      GRAB_MODE_ASYNC,
      GRAB_MODE_ASYNC,
      NONE,
      NONE,
      1,
      MOD_1_MASK,
    );
    X.GrabButton(
      display.screen[0].root,
      true,
      x11.eventMask.ButtonPress |
        x11.eventMask.ButtonRelease |
        x11.eventMask.PointerMotion,
      GRAB_MODE_ASYNC,
      GRAB_MODE_ASYNC,
      NONE,
      NONE,
      3,
      MOD_1_MASK,
    );
  })
  .on('event', (event: any) => {
    console.log('Received', event.name, 'event.');

    if (event.name === 'MapRequest' && event.child !== 0) {
      manageWindow(event.wid);
    } else if (event.name === 'UnmapNotify' && event.child !== 0) {
      unmanageWindow(event.wid);
    } else if (event.name === 'ConfigureRequest' && event.child !== 0) {
      X.ResizeWindow(event.wid, event.width, event.height);
    } else if (event.name === 'KeyPress' && event.child !== 0) {
      keyPressHandler(event);
    } else if (event.name === 'ButtonPress' && event.child !== 0) {
      X.RaiseWindow(event.child);
      X.GetGeometry(event.child, (_err: any, attributes: any) => {
        start = event;
        attr = attributes;
      });
    } else if (
      event.name === 'MotionNotify' &&
      typeof start !== 'undefined' &&
      start.child !== 0
    ) {
      var xdiff = event.rootx - start.rootx,
        ydiff = event.rooty - start.rooty;
      X.MoveResizeWindow(
        start.child,
        attr.xPos + (start.keycode === 1 ? xdiff : 0),
        attr.yPos + (start.keycode === 1 ? ydiff : 0),
        Math.max(1, attr.width + (start.keycode === 3 ? xdiff : 0)),
        Math.max(1, attr.height + (start.keycode === 3 ? ydiff : 0)),
      );
    } else if (event.name === 'ButtonRelease') {
      start = undefined;
    }
  });
