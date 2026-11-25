/** Removal is restricted to an exact, previously disconnected connection. */
export const DASHBOARD_AI_REMOVAL_SCRIPT = `    let aiRemoveTarget = null;
    let aiRemovePending = false;

    function openAiRemoveDialog(id) {
      if (aiRemovePending) return;
      const connection = aiConnectionsList.find(item => item.id === id && item.status === 'revoked');
      if (!connection) return;
      openAiRemoval({ id, name: connection.clientName, kind: 'connection' });
    }

    function openOAuthRemoveDialog(id) {
      if (aiRemovePending) return;
      const client = aiClientsList.find(item => item.clientId === id && item.canRemove === true);
      if (!client) return;
      openAiRemoval({ id, name: client.clientName, kind: 'history' });
    }

    function openAiRemoval(target) {
      aiRemoveTarget = target;
      const history = target.kind === 'history';
      const dialog = document.getElementById('aiRemoveDialog');
      document.getElementById('aiRemoveTitle').textContent = 'Remove ' + target.name + (history ? ' OAuth history?' : '?');
      document.getElementById('aiRemoveDescription').textContent = history
        ? 'This permanently removes inactive OAuth credential history for your account. Shared registrations, devices, connection records and audit history remain. Previously issued legacy access tokens may remain valid until expiry.'
        : 'This permanently removes the disconnected connection record and its credentials. Your devices, other AI connections and audit history are unchanged.';
      document.getElementById('aiRemoveConfirm').textContent = history ? 'Remove history' : 'Remove connection';
      const feedback = document.getElementById('aiRemoveFeedback');
      feedback.hidden = true;
      feedback.textContent = '';
      dialog.oncancel = event => {
        if (aiRemovePending) event.preventDefault();
        else aiRemoveTarget = null;
      };
      dialog.showModal();
    }

    function aiRemovalExists(target) {
      return target.kind === 'history'
        ? aiClientsList.some(item => item.clientId === target.id)
        : aiConnectionsList.some(item => item.id === target.id);
    }

    function cancelAiRemove() {
      if (aiRemovePending) return;
      document.getElementById('aiRemoveDialog').close();
      aiRemoveTarget = null;
    }

    function finishAiRemoval(message) {
      aiClientNotice = message;
      document.getElementById('aiRemoveDialog').close();
      aiRemoveTarget = null;
      if (activeTab === 'ai-clients') {
        document.getElementById('tabContent').innerHTML = renderAiClientsPanel();
        document.getElementById('aiClientNotice')?.focus();
      }
    }

    async function confirmAiRemove() {
      if (!aiRemoveTarget || aiRemovePending) return;
      const target = aiRemoveTarget;
      const { id, name } = target;
      const history = target.kind === 'history';
      const confirmButton = document.getElementById('aiRemoveConfirm');
      const cancelButton = document.getElementById('aiRemoveCancel');
      const feedback = document.getElementById('aiRemoveFeedback');
      aiRemovePending = true;
      confirmButton.disabled = cancelButton.disabled = true;
      confirmButton.textContent = 'Removing…';
      feedback.hidden = true;
      try {
        const response = await fetch((history ? '/api/dashboard/ai-clients/' : '/api/dashboard/ai-connections/') + encodeURIComponent(id), {
          method: 'DELETE', headers: { 'X-SSH-MCP-Dashboard': '1' }
        });
        const detail = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(response.status === 401 ? 'Your session expired. Sign in again.' :
          (detail.error || 'Request failed (HTTP ' + response.status + ').'));
        if (detail.removed !== true || (history ? detail.clientId : detail.connectionId) !== id) throw new Error('The server did not confirm removal.');
        ++aiLoadGeneration;
        if (history) aiClientsList = aiClientsList.filter(item => item.clientId !== id);
        else aiConnectionsList = aiConnectionsList.filter(item => item.id !== id);
        finishAiRemoval(name + (history ? ' OAuth history removed.' : ' connection removed.') + ' Your devices are unchanged.');
        await loadAiClients();
        if (activeTab === 'ai-clients') document.getElementById('aiClientNotice')?.focus();
      } catch (error) {
        // A lost response is not proof of failure. Reconcile the authoritative inventory first.
        const refreshed = await loadAiClients();
        if (refreshed && !aiRemovalExists(target)) {
          finishAiRemoval(name + (history ? ' is no longer in your OAuth history.' : ' is no longer in your connection list.'));
          return;
        }
        feedback.textContent = 'Could not confirm removal. ' + error.message + ' Retry or cancel.';
        feedback.hidden = false;
      } finally {
        aiRemovePending = false;
        confirmButton.disabled = cancelButton.disabled = false;
        confirmButton.textContent = history ? 'Remove history' : 'Remove connection';
      }
    }
`;
