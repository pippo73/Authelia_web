# Authelia Config GUI

**Versione: v0.1**

Interfaccia web semplice per **caricare, modificare e generare** i file di
configurazione di Authelia (`configuration.yml` e `users_database.yml`), da
copiare poi sul server.

Un solo container: backend **FastAPI** (Python) che serve sia le API sia il
frontend statico (HTML/CSS/JS vanilla, nessun build step). L'hashing delle
password (**argon2id**, parametri di default di Authelia) è fatto lato server.

## Avvio

```bash
docker compose up --build
```

Poi apri <http://localhost:8089> (la porta host è definita in `compose.yml`).

Senza Docker (per sviluppo):

```bash
pip install -r backend/requirements.txt
uvicorn backend.app:app --reload --port 8080
```

## Come si usa

1. In alto scegli quale file editare: `configuration.yml` o `users_database.yml`.
2. **Carica** il file esistente dal disco (o usa *Carica esempio* / *Nuovo*).
3. Modifica i campi nei form (modalità **base**).
4. Spunta **Configurazione avanzata** per aprire l'editor **YAML grezzo** e
   modificare qualsiasi dettaglio non coperto dai form. *Applica ai form*
   rilegge i valori base dallo YAML.
5. **Genera file** → controlla il risultato → **Scarica** o **Copia** e portalo
   sul server Authelia.

### Password utenti

Nel form utente, scrivi la password in chiaro nel campo **Nuova password**:
alla generazione viene salvata come hash `argon2id`. Se lasci il campo vuoto,
l'hash esistente resta invariato.

## Lingue (i18n)

L'interfaccia è multilingua. Di serie: **italiano** e **inglese**. La lingua si
sceglie dal menu in alto a destra; la scelta è salvata nel browser e all'avvio
viene rilevata dalla lingua del browser (fallback: inglese).

### Aggiungere una lingua

Le traduzioni sono file JSON `chiave → testo` in [`frontend/locales/`](frontend/locales/).
Per aggiungere una lingua:

1. Copia `frontend/locales/en.json` in `frontend/locales/<codice>.json`
   (es. `de.json`, `fr.json`, `es.json`).
2. Imposta il campo `_name` col nome della lingua (es. `"Deutsch"`) e traduci
   tutti i valori. **Non cambiare le chiavi.**
3. Riavvia (o ricarica): il backend scandisce la cartella (`GET /api/locales`) e
   la nuova lingua compare automaticamente nel menu. Nessuna modifica al codice.

Usa `en.json` come file di riferimento: deve contenere **tutte** le chiavi.
Se una chiave manca in una traduzione, viene mostrata la chiave stessa.

## Filosofia: interventi chirurgici

Sul file caricato vengono modificati **solo** i campi gestiti dai form; commenti
e sezioni non toccate (`storage`, `notifier`, `authentication_backend`, ...)
restano intatti grazie a `ruamel.yaml`.

## Note di sicurezza

La GUI **non ha autenticazione propria** e parla col backend in HTTP semplice:
contenuti di configurazione e segreti vi transitano. Usala **solo su rete
fidata** (localhost, LAN, VPN/tailnet) — non esporla su internet, oppure
mettila dietro un reverse proxy con TLS e autenticazione (es. dietro la stessa
Authelia).

Hardening integrato:

- le risposte includono header di sicurezza (CSP, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`); le risposte API sono `no-store`;
- limiti sulle richieste (YAML 2 MB, password 1 KB) prevengono DoS banali
  tramite l'endpoint di hashing argon2;
- il container gira come **utente non privilegiato** e ha un healthcheck;
- nulla è persistito lato server: i file vivono solo nella sessione del browser.

## Limiti noti (v1)

- La modifica **base** delle regole `access_control` **ricrea** la lista con i
  campi supportati (domain, policy, subject, resources, networks). Per chiavi
  avanzate di regola (`methods`, `query`, `resources` complessi, subject
  annidati OR/AND) usa la **Configurazione avanzata** (YAML grezzo).
- I form base puntano allo schema **Authelia v4.38+** (`server.address`,
  `session.cookies`, `session.remember_me`). Config più vecchie vanno bene in
  lettura; per campi legacy usa la modalità avanzata.
- Lo strumento **non valida** l'intera config contro lo schema Authelia: prima
  del deploy verifica con `authelia validate-config`.
