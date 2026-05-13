const ARC_CHAIN_ID = "0x4CEF52";
const USDC_CONTRACT = "0x3600000000000000000000000000000000000000";
const NETWORK_FEE = 0.01;

const USDC_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)"
];

let provider, signer, usdcContract, walletAddress;
let ngnToUsdRate = 0;
let pendingAmount = 0;
let pendingRecipient = "";

// ─── Get the right ethereum provider ─────────────────────
function getProvider() {
  // If multiple wallets, find MetaMask specifically
  if (window.ethereum?.providers?.length) {
    const metamask = window.ethereum.providers.find(p => p.isMetaMask && !p.isMidenWallet);
    if (metamask) return metamask;
  }
  // Single wallet
  if (window.ethereum) return window.ethereum;
  return null;
}

// ─── Exchange Rate ────────────────────────────────────────
async function fetchRate() {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const data = await res.json();
    ngnToUsdRate = data.rates.NGN;
    document.getElementById("rateDisplay").textContent =
      `₦${ngnToUsdRate.toFixed(2)} = 1 USDC`;
  } catch {
    ngnToUsdRate = 1580;
    document.getElementById("rateDisplay").textContent =
      "₦1,580.00 = 1 USDC (cached)";
  }
}

// ─── Convert NGN → USDC ───────────────────────────────────
function convertToUSDC() {
  const ngn = parseFloat(document.getElementById("ngnAmount").value);
  if (!ngn || ngnToUsdRate === 0) return;
  const usdc = (ngn / ngnToUsdRate).toFixed(4);
  const total = (parseFloat(usdc) + NETWORK_FEE).toFixed(4);
  document.getElementById("usdcAmount").textContent = `${usdc} USDC`;
  document.getElementById("totalAmount").textContent = `${total} USDC`;
}

// ─── Connect Wallet ───────────────────────────────────────
async function connectWallet() {
  const ethereum = getProvider();

  if (!ethereum) {
    alert("MetaMask not found. Please install it from metamask.io");
    return;
  }

  try {
    document.getElementById("connectBtn").textContent = "Connecting...";

    // Step 1: Request accounts directly from the provider
    const accounts = await ethereum.request({
      method: "eth_requestAccounts"
    });

    if (!accounts || accounts.length === 0) {
      throw new Error("No accounts returned from MetaMask.");
    }

    walletAddress = accounts[0];

    // Step 2: Switch to Arc Testnet
    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ARC_CHAIN_ID }]
      });
    } catch (switchErr) {
      if (switchErr.code === 4902 || switchErr.code === -32603) {
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: ARC_CHAIN_ID,
            chainName: "Arc Testnet",
            rpcUrls: ["https://rpc.testnet.arc.network"],
            nativeCurrency: {
              name: "USDC",
              symbol: "USDC",
              decimals: 18
            },
            blockExplorerUrls: ["https://testnet.arcscan.app"]
          }]
        });
      }
    }

    // Step 3: Build provider using the correct ethereum object
    provider = new ethers.providers.Web3Provider(ethereum, "any");
    signer = provider.getSigner();
    usdcContract = new ethers.Contract(
  "0x3600000000000000000000000000000000000000",
  [
    "function transfer(address to, uint256 amount) returns (bool)",
    "function balanceOf(address owner) view returns (uint256)"
  ],
  signer
);
    // Step 4: Update UI
    document.getElementById("connectBtn").style.display = "none";
    document.getElementById("walletInfo").style.display = "block";
    document.getElementById("walletAddress").textContent =
      walletAddress.slice(0, 6) + "..." + walletAddress.slice(-4);
    document.getElementById("sendBtn").disabled = false;

    await updateBalance();
    loadHistory();

  } catch (err) {
    console.error("Connection error:", err);
    document.getElementById("connectBtn").textContent = "Connect Wallet";
    alert("Failed: " + err.message);
  }
}

// ─── Disconnect ───────────────────────────────────────────
function disconnectWallet() {
  provider = null;
  signer = null;
  usdcContract = null;
  walletAddress = null;

  document.getElementById("connectBtn").style.display = "block";
  document.getElementById("connectBtn").textContent = "Connect Wallet";
  document.getElementById("walletInfo").style.display = "none";
  document.getElementById("usdcBalance").textContent = "0.00";
  document.getElementById("sendBtn").disabled = true;
  document.getElementById("historyCard").style.display = "none";
  showStatus("", "");
}

// ─── Balance ──────────────────────────────────────────────
async function updateBalance() {
  try {
    const ethereum = getProvider();
    const tempProvider = new ethers.providers.Web3Provider(ethereum, "any");
    const raw = await tempProvider.getBalance(walletAddress);
    const formatted = ethers.utils.formatUnits(raw, 18);
    document.getElementById("usdcBalance").textContent =
      parseFloat(formatted).toFixed(2);
  } catch (e) {
    console.error("Balance error:", e);
    document.getElementById("usdcBalance").textContent = "0.00";
  }
}

// ─── Copy Address ─────────────────────────────────────────
function copyAddress() {
  if (!walletAddress) return;
  navigator.clipboard.writeText(walletAddress);
  const toast = document.getElementById("toast");
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2000);
}

// ─── Confirm Modal ────────────────────────────────────────
function confirmSend() {
  const recipient = document.getElementById("recipientAddress").value.trim();
  const ngn = parseFloat(document.getElementById("ngnAmount").value);

  if (!recipient || !ethers.utils.isAddress(recipient)) {
    showStatus("error", "Please enter a valid wallet address.");
    return;
  }
  if (!ngn || ngn <= 0) {
    showStatus("error", "Please enter a valid NGN amount.");
    return;
  }
  if (!walletAddress) {
    showStatus("error", "Please connect your wallet first.");
    return;
  }

  pendingAmount = (ngn / ngnToUsdRate).toFixed(4);
  pendingRecipient = recipient;
  const total = (parseFloat(pendingAmount) + NETWORK_FEE).toFixed(4);

  document.getElementById("modalAmount").textContent = `${pendingAmount} USDC`;
  document.getElementById("modalRecipient").textContent = recipient;
  document.getElementById("modalTotal").textContent = `${total} USDC`;
  document.getElementById("modal").style.display = "flex";
}

function closeModal() {
  document.getElementById("modal").style.display = "none";
}

// ─── Send USDC ────────────────────────────────────────────
async function sendUSDC() {
  closeModal();
  showStatus("pending", "⏳ Confirm the transaction in MetaMask...");

  try {
    const amount = ethers.utils.parseUnits(pendingAmount, 18);
    const tx = await signer.sendTransaction({
      to: pendingRecipient,
      value: amount
    });

    // Show explorer link immediately — don't wait for confirmation
    showStatus("success",
      `✅ Transaction submitted!<br><br>
      Amount: <strong>${pendingAmount} USDC</strong><br><br>
      <a href="https://testnet.arcscan.app/tx/${tx.hash}"
         target="_blank">View on Arc Explorer ↗</a><br><br>
      <small style="color:#4a5568">Confirming on chain...</small>`
    );

    saveTransaction(pendingRecipient, pendingAmount, tx.hash);
    saveRecipient(pendingRecipient);

    // Wait in background — update UI when done
    tx.wait().then(async () => {
      showStatus("success",
        `✅ Sent ${pendingAmount} USDC successfully!<br><br>
        <a href="https://testnet.arcscan.app/tx/${tx.hash}"
           target="_blank">View on Arc Explorer ↗</a>`
      );
      await updateBalance();
    }).catch(err => {
      console.warn("Wait error:", err);
    });

  } catch (err) {
    console.error("Send error:", err);
    showStatus("error", `❌ Transaction failed: ${err.message}`);
  }
}

// ─── Transaction History ──────────────────────────────────
function saveTransaction(to, amount, hash) {
  const history = JSON.parse(localStorage.getItem("arcsend_history") || "[]");
  history.unshift({ to, amount, hash, time: new Date().toLocaleString() });
  localStorage.setItem("arcsend_history", JSON.stringify(history.slice(0, 20)));
  loadHistory();
}

function loadHistory() {
  const history = JSON.parse(localStorage.getItem("arcsend_history") || "[]");
  if (history.length === 0) return;

  document.getElementById("historyCard").style.display = "block";
  document.getElementById("txCount").textContent = history.length;

  document.getElementById("txList").innerHTML = history.map(tx => `
    <div class="tx-item">
      <div class="tx-left">
        <div class="tx-to">${tx.to.slice(0,6)}...${tx.to.slice(-4)}</div>
        <div class="tx-time">${tx.time}</div>
      </div>
      <div class="tx-right">
        <div class="tx-amount">-${tx.amount} USDC</div>
        <div class="tx-hash"
          onclick="window.open('https://testnet.arcscan.app/tx/${tx.hash}','_blank')">
          View TX ↗
        </div>
      </div>
    </div>
  `).join("");
}

function clearHistory() {
  localStorage.removeItem("arcsend_history");
  localStorage.removeItem("arcsend_recipients");
  document.getElementById("historyCard").style.display = "none";
  document.getElementById("txCount").textContent = "0";
}

// ─── Recent Recipients ────────────────────────────────────
function saveRecipient(address) {
  const saved = JSON.parse(localStorage.getItem("arcsend_recipients") || "[]");
  const updated = [address, ...saved.filter(a => a !== address)].slice(0, 5);
  localStorage.setItem("arcsend_recipients", JSON.stringify(updated));
}

function checkRecent() {
  const saved = JSON.parse(localStorage.getItem("arcsend_recipients") || "[]");
  const input = document.getElementById("recipientAddress").value.toLowerCase();
  const filtered = saved.filter(a => a.toLowerCase().includes(input));
  const box = document.getElementById("recentBox");
  const list = document.getElementById("recentList");

  if (filtered.length === 0 || input.length > 40) {
    box.style.display = "none";
    return;
  }

  box.style.display = "block";
  list.innerHTML = filtered.map(addr => `
    <div class="recent-item" onclick="useRecipient('${addr}')">
      <span class="addr">${addr.slice(0,8)}...${addr.slice(-6)}</span>
      <span class="use-btn">Use →</span>
    </div>
  `).join("");
}

function useRecipient(address) {
  document.getElementById("recipientAddress").value = address;
  document.getElementById("recentBox").style.display = "none";
}

// ─── Status ───────────────────────────────────────────────
function showStatus(type, message) {
  const box = document.getElementById("statusBox");
  box.className = `status-box ${type}`;
  box.innerHTML = message;
}

// ─── Init ─────────────────────────────────────────────────
fetchRate();
loadHistory();