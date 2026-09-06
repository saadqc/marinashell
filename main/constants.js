const path = require('path');

const ICON_PATH = path.join(__dirname, '..', 'assets', 'icons', 'dock.png');
const LOCAL_HOST_VALUE = '__local__';

const DEFAULT_STATE = {
  knownHosts: [],
  lastHost: '',
  recentLocations: {},
  savedLocations: {},
  diskMountSelection: {},
  tabs: [],
  activeTabId: '',
  tabGroups: [],
  sidebarCollapsed: false
};

const DEFAULT_SETTINGS = {
  editor: {
    open: {
      mode: { type: 'string', value: 'remote-shell' },
      commandTemplate: { type: 'string', value: 'nano {escapedPath}' },
      localCommandTemplate: { type: 'string', value: 'code --reuse-window {path}' },
      sftpUriTemplate: { type: 'string', value: 'sftp://{user}@{host}:{port}{path}' }
    },
    associations: {
      list: {
        type: 'array',
        value: [
          {
            pattern: '*.log',
            mode: 'remote-shell',
            commandTemplate: 'less {escapedPath}'
          }
        ]
      }
    }
  },
  ui: {
    tree: {
      pageSize: { type: 'number', value: 500 }
    },
    session: {
      restoreTabs: { type: 'boolean', value: false },
      tabTitleTemplate: { type: 'string', value: '<ssh_machine>:<current_folder_name[:15]>' },
      defaultTabColor: { type: 'string', value: 'default' }
    },
    shortcuts: {
      newTab: { type: 'string', value: 'mod+t' },
      closeTab: { type: 'string', value: 'mod+w' }
    },
    connection: {
      autoConnectOnSelect: { type: 'boolean', value: false },
      autoStartTunnels: { type: 'boolean', value: true }
    }
  },
  shell: {
    local: {
      command: { type: 'string', value: '' },
      args: { type: 'string', value: '' },
      pathPrepend: { type: 'string', value: '' },
      injectMacPaths: { type: 'boolean', value: true }
    }
  },
  plugins: {
    enabled: {
      list: { type: 'array', value: [] }
    },
    disabled: {
      list: { type: 'array', value: [] }
    },
    docker: {
      enableRpc: { type: 'boolean', value: false }
    }
  }
};

module.exports = {
  DEFAULT_STATE,
  DEFAULT_SETTINGS,
  ICON_PATH,
  LOCAL_HOST_VALUE
};
