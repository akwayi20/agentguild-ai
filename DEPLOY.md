# Deploy checklist

Do these on your own machine. Keep the deployer key out of chat, screenshots and Git.

## 1. Contracts

```bash
git clone https://github.com/akwayi20/agentguild-ai && cd agentguild-ai
npm install
cp .env.example .env
```

Edit `.env`:
- `DEPLOYER_PRIVATE_KEY`: a brand-new wallet that holds only the BNB needed for gas
- `BSCSCAN_API_KEY`: from your BscScan account

Optional rehearsal (the official Agent ID lives on mainnet, so testnet uses a mock):

```bash
USE_MOCK_AGENT_ID=true npm run deploy:testnet
```

Mainnet:

```bash
npm test
npm run deploy:mainnet     # writes deployments/bsc.json
npm run verify:mainnet     # BscScan source verification
git add deployments/bsc.json && git commit -m "Add mainnet deployment" && git push
```

Before running it, confirm the Agent ID address in `config/adoption.json` against the hackathon page.

## 2. Website (Vercel)

1. Import the GitHub repo in Vercel and set **Root Directory** to `frontend`.
2. Add the variables from `frontend/.env.example`. Copy the four contract addresses from `deployments/bsc.json`. Set `NEXT_PUBLIC_AGENT_ID_CLAIM_URL` to the official claim page.
3. Deploy. Open the site in Binance Wallet and run one full task flow yourself.

## 3. Before submitting

```bash
# set the manual checks you have personally confirmed in config/manual-checks.json
npm run monitor:mainnet
```

The submission is ready only when the report says YES. Target: 100 unique Agent ID addresses, minimum 30, between 18 Nov 08:00 UTC and 9 Dec 08:00 UTC.
