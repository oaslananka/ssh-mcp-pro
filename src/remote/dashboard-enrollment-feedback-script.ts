/** Client-side enrollment status and first-run feedback embedded in the dashboard HTML. */
export const DASHBOARD_ENROLLMENT_FEEDBACK_SCRIPT = `
    let enrollmentPollTimer = null;
    let enrollmentPollAgentId = null;
    let enrollmentPollAttempts = 0;
    let enrollmentPollInFlight = false;
    let enrollmentGenerationInFlight = false;

    // The link only contains a random handshake challenge, never a bearer token.
    // sessionStorage keeps it in the same browser tab through Google/GitHub login.
    function readLocalBrowserLink() {
      if (typeof window === 'undefined') return null;
      let candidate = null;
      try {
        const params = new URLSearchParams(window.location.search);
        const port = Number(params.get('local_enroll_port'));
        const state = params.get('local_enroll_state');
        if (Number.isInteger(port) && port >= 1024 && port <= 65535 &&
            typeof state === 'string' && /^[A-Za-z0-9_-]{43}$/.test(state)) {
          candidate = {
            port, state,
            alias: (params.get('local_enroll_alias') || '').slice(0, 80),
            expiresAt: Date.now() + 600000
          };
          window.sessionStorage?.setItem('ssh-mcp-local-enroll', JSON.stringify(candidate));
        } else {
          const previous = window.sessionStorage?.getItem('ssh-mcp-local-enroll');
          if (previous) candidate = JSON.parse(previous);
        }
      } catch {
        // Browsers with disabled storage can still use the initial URL.
      }
      if (!candidate || !Number.isInteger(candidate.port) ||
          candidate.port < 1024 || candidate.port > 65535 ||
          typeof candidate.state !== 'string' ||
          !/^[A-Za-z0-9_-]{43}$/.test(candidate.state) ||
          !Number.isFinite(candidate.expiresAt) || candidate.expiresAt < Date.now()) {
        return null;
      }
      return candidate;
    }

    async function queryLocalLoopbackPermission() {
      if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'prompt';
      try {
        const result = await navigator.permissions.query({ name: 'loopback-network' });
        return result.state;
      } catch {
        // Browser has no LNA permission query. The user click will trigger the
        // permission prompt on browsers that implement Local Network Access.
        return 'prompt';
      }
    }

    let localBrowserLink = readLocalBrowserLink();
    if (localBrowserLink && currentUser) activeTab = 'add-device';

    function completeLocalBrowserLink() {
      localBrowserLink = null;
      try {
        window.sessionStorage?.removeItem('ssh-mcp-local-enroll');
        window.history?.replaceState(null, '', '/dashboard');
      } catch { /* storage/history unavailable */ }
    }

    function stopEnrollmentPolling() {
      if (enrollmentPollTimer !== null) clearInterval(enrollmentPollTimer);
      enrollmentPollTimer = null;
      enrollmentPollAgentId = null;
      enrollmentPollAttempts = 0;
    }

    function updateEnrollmentStatus(message) {
      const node = document.getElementById('enrollStatus');
      if (node) node.textContent = message;
    }

    async function pollEnrollmentStatus() {
      const agentId = enrollmentPollAgentId;
      if (!agentId || activeTab !== 'add-device' || enrollmentPollInFlight) return;
      enrollmentPollInFlight = true;
      enrollmentPollAttempts += 1;
      try {
        const res = await fetch('/api/dashboard/devices', { cache: 'no-store' });
        if (enrollmentPollAgentId !== agentId || activeTab !== 'add-device') return;
        if (res.status === 401) {
          updateEnrollmentStatus('Your session expired. Sign in again to check your device.');
          stopEnrollmentPolling();
          return;
        }
        if (!res.ok) throw new Error('Device status temporarily unavailable');
        const data = await res.json();
        if (enrollmentPollAgentId !== agentId || activeTab !== 'add-device') return;
        const devices = Array.isArray(data.devices) ? data.devices : [];
        const device = devices.find(item => item.id === agentId);
        if (device?.isLiveConnected) {
          updateEnrollmentStatus('Live Online — your device is connected and ready. Open Enrolled Devices to use it.');
          const viewButton = document.getElementById('enrollViewDevice');
          if (viewButton) {
            viewButton.hidden = false;
            viewButton.style.display = 'inline-block';
          }
          stopEnrollmentPolling();
          return;
        }
        if (device?.status === 'revoked') {
          updateEnrollmentStatus('This device registration was revoked. Create a fresh enrollment command to try again.');
          stopEnrollmentPolling();
          return;
        }
      } catch {
        if (enrollmentPollAgentId === agentId) {
          updateEnrollmentStatus('Waiting for the device. Connection status is temporarily unavailable; checking again.');
        }
      } finally {
        enrollmentPollInFlight = false;
        if (enrollmentPollAgentId === agentId && enrollmentPollAttempts >= 60) {
          updateEnrollmentStatus('Device is not online yet. Check the installer output; if the token expired, create a fresh command.');
          stopEnrollmentPolling();
        }
      }
    }

    function watchEnrollment(agentId) {
      stopEnrollmentPolling();
      updateEnrollmentStatus('Waiting for your device to connect. Copy its install command and run it on that device.');
      if (!agentId) return;
      enrollmentPollAgentId = agentId;
      enrollmentPollTimer = setInterval(() => { void pollEnrollmentStatus(); }, 5000);
    }


    async function generateEnrollment() {
      if (enrollmentGenerationInFlight) return;
      enrollmentGenerationInFlight = true;
      stopEnrollmentPolling();
      const button = document.getElementById('generateEnrollmentButton');
      const errorNode = document.getElementById('enrollError');
      const outputNode = document.getElementById('enrollOutput');
      if (button) { button.disabled = true; button.textContent = 'Generating...'; }
      if (errorNode) { errorNode.hidden = true; errorNode.textContent = ''; }
      if (outputNode) outputNode.style.display = 'none';
      for (const id of ['cmdLinux', 'cmdWindows', 'cmdNpm']) {
        const node = document.getElementById(id);
        if (node) node.textContent = '';
      }
      const alias = document.getElementById('enrollAlias').value.trim() ||
        localBrowserLink?.alias || 'server-' + Math.floor(Math.random() * 1000);
      const profile = document.getElementById('enrollProfile').value;
      try {
        if (localBrowserLink) {
          const localPermission = await queryLocalLoopbackPermission();
          if (localPermission === 'denied') {
            throw new Error('Local device access is blocked. Allow Loopback network access for this site in browser Site settings, then retry.');
          }
          let reachable = false;
          try {
            const result = await fetch('http://127.0.0.1:' + localBrowserLink.port + '/ready', {
              cache: 'no-store', mode: 'cors', targetAddressSpace: 'loopback'
            });
            reachable = result.ok;
          } catch { /* browser and local WSL listener may not share localhost */ }
          if (!reachable) {
            throw new Error('Cannot reach the local agent on this device. Open this link in a browser on the device being enrolled, allow Loopback network access when prompted, then retry.');
          }
        }
        const res = await fetch('/api/dashboard/devices/enroll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-SSH-MCP-Dashboard': '1' },
          body: JSON.stringify({ alias, requested_profile: profile })
        });
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          throw new Error(typeof detail.error === 'string' ? detail.error : 'Could not generate an install command. Try again.');
        }
        const data = await res.json();
        if (activeTab !== 'add-device') return;
        const wasLocalEnrollment = Boolean(localBrowserLink);
        if (!data.commands || ['linux', 'windows', 'npm'].some(key => typeof data.commands[key] !== 'string')) {
          throw new Error('The server returned incomplete installation commands. Try again.');
        }
        if (localBrowserLink) {
          if (typeof data.enrollment_token !== 'string' || !data.enrollment_token) {
            throw new Error('The server did not return a one-time enrollment credential.');
          }
          let delivered;
          try {
            delivered = await fetch('http://127.0.0.1:' + localBrowserLink.port + '/enroll', {
              method: 'POST',
              mode: 'cors',
              targetAddressSpace: 'loopback',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ state: localBrowserLink.state, token: data.enrollment_token })
            });
          } catch {
            throw new Error('Cannot reach the local agent. Keep the terminal open and retry with a fresh alias after the pending enrollment expires.');
          }
          if (!delivered.ok) throw new Error('Local agent rejected this enrollment; check the terminal and retry.');
          completeLocalBrowserLink();
          document.getElementById('manualInstallCommands').style.display = 'none';
        } else {
          document.getElementById('cmdLinux').textContent = data.commands.linux;
          document.getElementById('cmdWindows').textContent = data.commands.windows;
          document.getElementById('cmdNpm').textContent = data.commands.npm;
          document.getElementById('manualInstallCommands').style.display = 'block';
        }
        document.getElementById('enrollOutput').style.display = 'block';
        const viewButton = document.getElementById('enrollViewDevice');
        if (viewButton) { viewButton.hidden = true; viewButton.style.display = 'none'; }
        watchEnrollment(typeof data.agent_id === 'string' ? data.agent_id : null);
        if (wasLocalEnrollment) updateEnrollmentStatus('Browser approval accepted. Waiting for your local agent to come online.');
      } catch (e) {
        if (activeTab === 'add-device' && errorNode) {
          errorNode.hidden = false;
          errorNode.textContent = e?.message || 'Could not generate an install command. Try again.';
        }
      } finally {
        enrollmentGenerationInFlight = false;
        if (button && button.isConnected !== false) {
          button.disabled = false;
          button.textContent = localBrowserLink ? 'Approve This Device' : 'Generate Install Command';
        }
      }
    }

`;
