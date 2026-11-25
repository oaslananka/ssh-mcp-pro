/** Browser-side device operations; only server-confirmed state changes are reported as successful. */
export const DASHBOARD_DEVICE_MANAGEMENT_SCRIPT = `    let deviceAction = null;
    let deviceActionPending = false;

    async function loadDevices() {
      const generation = ++deviceLoadGeneration;
      try {
        const res = await fetch('/api/dashboard/devices', { cache: 'no-store' });
        if (!res.ok) throw new Error('Device API unavailable');
        const data = await res.json();
        if (!Array.isArray(data.devices)) throw new Error('Invalid device list');
        if (generation !== deviceLoadGeneration) return false;
        devicesList = data.devices;
        if (typeof data.strictVisibility === 'boolean') strictVisibilityEnabled = data.strictVisibility;
        devicesError = '';
        return true;
      } catch (e) {
        if (generation !== deviceLoadGeneration) return false;
        devicesError = 'unavailable';
        console.error('Failed to load devices', e);
        return false;
      } finally {
        if (generation === deviceLoadGeneration) {
          devicesLoaded = true;
          if (activeTab === 'devices') renderApp();
        }
      }
    }

    function openDeviceAction(id, kind) {
      if (deviceActionPending) return;
      const device = devicesList.find(item => item.id === id);
      if (!device) return;
      deviceAction = { id, kind, alias: device.alias };
      const dialog = document.getElementById('deviceActionDialog');
      document.getElementById('deviceActionTitle').textContent =
        (kind === 'remove' ? 'Remove ' : 'Revoke access for ') + device.alias + '?';
      document.getElementById('deviceActionDescription').textContent = kind === 'remove'
        ? 'This disconnects the agent, removes the device and its AI access grants, and retains audit history. To use it again, enroll it again. Files on the computer are not deleted.'
        : 'This disconnects the agent and blocks AI access. The device stays in your list until you remove it.';
      const feedback = document.getElementById('deviceActionFeedback');
      feedback.hidden = true;
      feedback.textContent = '';
      document.getElementById('deviceActionConfirm').textContent = kind === 'remove' ? 'Remove device' : 'Revoke access';
      dialog.oncancel = event => {
        if (deviceActionPending) event.preventDefault();
        else deviceAction = null;
      };
      dialog.showModal();
    }

    function cancelDeviceAction() {
      if (deviceActionPending) return;
      document.getElementById('deviceActionDialog').close();
      deviceAction = null;
    }

    function revokeDevice(id) { openDeviceAction(id, 'revoke'); }
    function removeDevice(id) { openDeviceAction(id, 'remove'); }

    async function confirmDeviceAction() {
      if (!deviceAction || deviceActionPending) return;
      const { id, kind, alias } = deviceAction;
      const confirmButton = document.getElementById('deviceActionConfirm');
      const cancelButton = document.getElementById('deviceActionCancel');
      const feedback = document.getElementById('deviceActionFeedback');
      deviceActionPending = true;
      confirmButton.disabled = cancelButton.disabled = true;
      confirmButton.textContent = kind === 'remove' ? 'Removing…' : 'Revoking…';
      feedback.hidden = true;
      try {
        const endpoint = '/api/dashboard/devices/' + encodeURIComponent(id);
        const res = await fetch(endpoint + (kind === 'revoke' ? '/revoke' : ''), {
          method: kind === 'remove' ? 'DELETE' : 'POST',
          headers: { 'X-SSH-MCP-Dashboard': '1' }
        });
        const detail = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(res.status === 401 ? 'Your session expired. Sign in again.' :
            (detail.error || 'Request failed (HTTP ' + res.status + ').'));
        }
        const confirmed = kind === 'remove'
          ? detail.removed === true && detail.agent_id === id
          : detail.device?.id === id && detail.device.status === 'revoked';
        if (!confirmed) throw new Error('The server did not confirm the change.');
        ++deviceLoadGeneration;
        if (kind === 'remove') {
          devicesList = devicesList.filter(device => device.id !== id);
        } else {
          devicesList = devicesList.map(device => device.id === id
            ? { ...device, ...detail.device, isLiveConnected: false } : device);
        }
        deviceNotice = kind === 'remove' ? alias + ' was removed.' : 'Access revoked for ' + alias + '.';
        document.getElementById('deviceActionDialog').close();
        deviceAction = null;
        if (activeTab === 'devices') renderApp();
        await loadDevices();
        if (activeTab === 'devices') document.getElementById('deviceNotice')?.focus();
      } catch (e) {
        // The request may have reached the server even if its response was lost.
        // Read back the authoritative inventory before asking the user to retry.
        const refreshed = await loadDevices();
        if (refreshed && (kind === 'remove'
          ? !devicesList.some(device => device.id === id)
          : devicesList.some(device => device.id === id && device.status === 'revoked'))) {
          deviceNotice = kind === 'remove' ? alias + ' is no longer in your device list.' : 'Access revoked for ' + alias + '.';
          document.getElementById('deviceActionDialog').close();
          deviceAction = null;
          if (activeTab === 'devices') {
            renderApp();
            document.getElementById('deviceNotice')?.focus();
          }
          return;
        }
        feedback.textContent = 'Could not confirm the change. ' + e.message + ' Retry or cancel and refresh.';
        feedback.hidden = false;
      } finally {
        deviceActionPending = false;
        confirmButton.disabled = cancelButton.disabled = false;
        confirmButton.textContent = kind === 'remove' ? 'Remove device' : 'Revoke access';
      }
    }

    async function changePolicy(id, profile) {
      deviceNotice = '';
      try {
        const res = await fetch('/api/dashboard/devices/' + encodeURIComponent(id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-SSH-MCP-Dashboard': '1' },
          body: JSON.stringify({ policy: { profile } })
        });
        if (!res.ok) throw new Error('Request failed (HTTP ' + res.status + ').');
        const detail = await res.json();
        if (detail.device?.id !== id || detail.device.profile !== profile) throw new Error('The server did not confirm the profile.');
        deviceNotice = 'Permission profile updated.';
      } catch (e) {
        deviceNotice = 'Could not confirm the permission change. ' + e.message;
      }
      await loadDevices();
    }
`;
