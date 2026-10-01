# Motore da casa (Windows)

Per i primi giorni il motore gira sul tuo PC invece che su un server in affitto. Quando il progetto rende, si sposta su Railway in 10 minuti senza cambiare il codice.

## Cosa serve (una volta sola)

1. **Node.js 22**: scaricalo da https://nodejs.org (versione LTS 22) e installalo.
2. **Il codice**: scarica la repo da GitHub (pulsante *Code → Download ZIP*) ed estraila, per esempio sul Desktop.
3. **Il file delle impostazioni**: nella cartella `engine` copia `.env.example` in un nuovo file chiamato `.env` e compilalo (chiavi dei wallet, Supabase, Helius…). Le chiavi le scrivi solo tu, qui, mai in chat.
4. **Cloudflare Tunnel** (gratis), così il sito e Helius raggiungono il motore senza toccare il router:
   - compra il dominio su **Cloudflare** (oppure sposta lì il DNS del dominio che compri altrove);
   - installa `cloudflared`: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
   - apri il Prompt dei comandi e lancia, una riga alla volta:
     ```
     cloudflared tunnel login
     cloudflared tunnel create circo-engine
     cloudflared tunnel route dns circo-engine motore.TUODOMINIO
     ```
   - crea il file `C:\Users\<tuo utente>\.cloudflared\config.yml` con:
     ```
     tunnel: circo-engine
     credentials-file: C:\Users\<tuo utente>\.cloudflared\<ID-del-tunnel>.json
     ingress:
       - hostname: motore.TUODOMINIO
         service: http://localhost:8787
       - service: http_status:404
     ```
   L'indirizzo del motore sarà `https://motore.TUODOMINIO`: va messo su Vercel come `ENGINE_URL` e nel webhook di Helius. Non cambia mai, anche se riavvii.

## Ogni giorno

- **Avvio**: doppio click su `avvia-circo.bat`. Si aprono due finestre (motore e tunnel): lasciale aperte, anche ridotte a icona.
- **Controllo**: doppio click su `stato.bat`: deve rispondere `"ok":true`.
- Se il motore si blocca o si chiude, riparte da solo dopo 5 secondi.

## Regole per quei giorni

- Il PC resta **acceso e collegato all'alimentazione** (lo script disattiva la sospensione con l'alimentatore).
- **Sospendi gli aggiornamenti di Windows** per una settimana: *Impostazioni → Windows Update → Sospendi*. Un riavvio automatico fermerebbe il circo.
- Su quel PC **niente download o programmi sconosciuti**: le chiavi dei wallet premio e buyback sono nel file `.env`.
- Se salta la corrente o internet: riaccendi e fai doppio click su `avvia-circo.bat`. Le estrazioni riprendono da dove erano, nessun pagamento viene ripetuto e i biglietti comprati nel frattempo vengono recuperati dalla blockchain entro un minuto.

## Quando passare a un server

Quando le fee coprono qualche dollaro al mese, o se il PC ti serve spento: si crea il progetto su Railway con la stessa cartella `engine` e lo stesso `.env`, si aggiorna `ENGINE_URL` su Vercel e il webhook di Helius, e si spegne il PC.
