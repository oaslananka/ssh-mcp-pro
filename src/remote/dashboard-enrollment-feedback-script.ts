/** Client-side enrollment status and first-run feedback embedded in the dashboard HTML. */
export const DASHBOARD_ENROLLMENT_FEEDBACK_SCRIPT = `
    let enrollmentPollTimer = null;
    let enrollmentPollAgentId = null;
    let enrollmentPollAttempts = 0;
    let enrollmentPollInFlight = false;
    let enrollmentGenerationInFlight = false;

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
      const alias = document.getElementById('enrollAlias').value.trim() || 'server-' + Math.floor(Math.random() * 1000);
      const profile = document.getElementById('enrollProfile').value;
      try {
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
        if (!data.commands || ['linux', 'windows', 'npm'].some(key => typeof data.commands[key] !== 'string')) {
          throw new Error('The server returned incomplete installation commands. Try again.');
        }
        document.getElementById('cmdLinux').textContent = data.commands.linux;
        document.getElementById('cmdWindows').textContent = data.commands.windows;
        document.getElementById('cmdNpm').textContent = data.commands.npm;
        document.getElementById('enrollOutput').style.display = 'block';
        const viewButton = document.getElementById('enrollViewDevice');
        if (viewButton) { viewButton.hidden = true; viewButton.style.display = 'none'; }
        watchEnrollment(typeof data.agent_id === 'string' ? data.agent_id : null);
      } catch (e) {
        if (activeTab === 'add-device' && errorNode) {
          errorNode.hidden = false;
          errorNode.textContent = e?.message || 'Could not generate an install command. Try again.';
        }
      } finally {
        enrollmentGenerationInFlight = false;
        if (button && button.isConnected !== false) {
          button.disabled = false;
          button.textContent = 'Generate Install Command';
        }
      }
    }

`;
