const { contextBridge } = require('electron');

// IPC remains intentionally empty during step 1.
// System metrics and ADB will be exposed through narrowly scoped APIs in later steps.
contextBridge.exposeInMainWorld('taskManagerBridge', Object.freeze({
  version: 'step-1',
  capabilities: Object.freeze({
    systemMetrics: false,
    adb: false
  })
}));
