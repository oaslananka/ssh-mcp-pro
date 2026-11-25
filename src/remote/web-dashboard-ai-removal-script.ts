/** Removal is restricted to an exact, previously disconnected connection. */
export const DASHBOARD_AI_REMOVAL_SCRIPT = `    let aiRemoveTarget = null;
    let aiRemovePending = false;

    function openAiRemoveDialog(id) {
      if (aiRemovePending) return;
      const connection = aiConnectionsList.find(item => item.id === id && item.status === 'revoked');
      if (!connection) return;
      aiRemoveTarget = { id, name: connection.clientName };
      const dialog = document.getElementById('aiRemoveDialog');
      document.getElementById('aiRemoveTitle').textContent = 'Remove ' + connection.clientName + '?';
      const feedback = document.getElementById('aiRemoveFeedback');
      feedback.hidden = true;
      feedback.textContent = '';
      dialog.oncancel = event => {
        if (aiRemovePending) event.preventDefault();
        else aiRemoveTarget = null;
      };
      dialog.showModal();
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
      const { id, name } = aiRemoveTarget;
      const confirmButton = document.getElementById('aiRemoveConfirm');
      const cancelButton = document.getElementById('aiRemoveCancel');
      const feedback = document.getElementById('aiRemoveFeedback');
      aiRemovePending = true;
      confirmButton.disabled = cancelButton.disabled = true;
      confirmButton.textContent = 'Removing…';
      feedback.hidden = true;
      try {
        const response = await fetch('/api/dashboard/ai-connections/' + encodeURIComponent(id), {
          method: 'DELETE', headers: { 'X-SSH-MCP-Dashboard': '1' }
        });
        const detail = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(response.status === 401 ? 'Your session expired. Sign in again.' :
          (detail.error || 'Request failed (HTTP ' + response.status + ').'));
        if (detail.removed !== true || detail.connectionId !== id) throw new Error('The server did not confirm removal.');
        ++aiLoadGeneration;
        aiConnectionsList = aiConnectionsList.filter(item => item.id !== id);
        finishAiRemoval(name + ' connection removed. Your devices are unchanged.');
        await loadAiClients();
        if (activeTab === 'ai-clients') document.getElementById('aiClientNotice')?.focus();
      } catch (error) {
        // A lost response is not proof of failure. Reconcile the authoritative inventory first.
        const refreshed = await loadAiClients();
        if (refreshed && !aiConnectionsList.some(item => item.id === id)) {
          finishAiRemoval(name + ' is no longer in your connection list.');
          return;
        }
        feedback.textContent = 'Could not confirm removal. ' + error.message + ' Retry or cancel.';
        feedback.hidden = false;
      } finally {
        aiRemovePending = false;
        confirmButton.disabled = cancelButton.disabled = false;
        confirmButton.textContent = 'Remove connection';
      }
    }
`;
