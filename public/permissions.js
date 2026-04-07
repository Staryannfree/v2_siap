const btn = document.getElementById('requestBtn');
const status = document.getElementById('status');

if (btn) {
    btn.onclick = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // Stop the stream immediately, we just want the permission
            stream.getTracks().forEach(track => track.stop());
            
            if (status) {
                status.innerText = "✅ Permissão concedida! Você já pode fechar esta aba.";
                status.className = "status success";
            }
            btn.style.display = "none";
            
            // Optional: close after a delay
            setTimeout(() => {
                window.close();
            }, 3000);
        } catch (err) {
            console.error(err);
            if (status) {
                status.innerText = "❌ Erro ao autorizar. Verifique se o microfone está conectado e tente novamente.";
                status.className = "status error";
            }
        }
    };
}
