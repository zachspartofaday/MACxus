# Getting started / Primi passi

**[English](#english)** · **[Italiano](#italiano)**

## English

These steps apply to releases that include the bundled Apple Silicon backend.
The betas through `0.3.11-mac.3` required a local backend build; choose a release
whose notes say the backend is included. Developers building from source can follow
[the maintainer guide](MAC-BACKEND.md).

### 1. Check your Mac

MACxus needs an Apple Silicon Mac (M1 or later), Rosetta 2 and CrossOver 26.x in
`/Applications`. CrossOver is paid software with a free trial and runs natively;
install Rosetta explicitly for the Windows games. Open **Terminal**, paste this
command and press Return (it accepts Apple's Rosetta license):

```sh
softwareupdate --install-rosetta --agree-to-license
```

### 2. Install MACxus

Download the Apple Silicon `.dmg` from
[Releases](https://github.com/fladnaG86/MACxus/releases), open it, and drag MACxus
to Applications. The beta app is unsigned. Try opening it once, then go to
**System Settings → Privacy & Security → Open Anyway**. Alternatively, open
Terminal and run this command for the app you just installed:

```sh
xattr -dr com.apple.quarantine /Applications/MACxus.app
```

The Xodus backend is included and becomes ready automatically. **You do not need
Homebrew, Git, Rust or protoc**, and you do not need to create a signing certificate.
If MACxus says its bundled backend cannot be verified, reinstall the app from the
release instead of installing developer tools.

### 3. Install the runtime and sign in

In **Settings**, choose **Install Nexus runtime** if no runtime is selected.
MACxus verifies and installs it. Optionally install the **Highball** Wine engine
for supported D3D12/Unreal games; CrossOver remains the default.

**Wine engine** also detects CrossOver Preview in Applications. Choose **Preview
(Rosetta)** for the regular build or **Preview (FEX/ARM)** for the ARM64 build.
Each Preview mode uses a separate bottle. The FEX option appears when its ARM64
engine is present; game compatibility can differ from Rosetta. Use **Refresh
engine detection** after installing or updating a Preview build. Highball still
requires regular CrossOver for its graphics libraries.

Choose **Sign in with Xodus**. Sign-in uses MACxus's own window: Chrome is not
needed. Use your Microsoft password, a code or the Authenticator app. Passkeys
are not supported on macOS yet; choose **Other ways to sign in** if Microsoft asks
for one. You need to own the game or have an appropriate PC Game Pass subscription.

### Keychain access prompts

Xodus stores device and account credentials in macOS Keychain. macOS can ask for
access separately for different records and for `xodus-cli` and `xodus-service`.
For a verified MACxus installation, **Always Allow** remembers a grant for that
executable and item; **Allow** grants the current request. A locked Keychain may
still need unlocking.

Ad-hoc-signed beta backends can prompt again when their binaries change in an
update. A maintainer can use [stable backend signing](MAC-BACKEND.md#optional-stable-backend-signing)
to preserve the executables' identity across builds. Creating a local certificate
and restarting a packaged app does not change its bundled signatures. Switching
to a signed build may still require initial grants. You do not need to delete
credentials, disable Keychain protection, or allow every application access.

### 4. Install a game

Choose a game in **My Library** or **Store**, then choose the drive/folder for it.
Use the **info** button beside a library card's install button to see Microsoft's
download and installed-size estimates. With a controller, highlight the card and
press **X (Options)** to open its size information. Game pages show sizes alongside
last played/time played, including for installed games. Installed size is measured
from the installed game's files when available; it is logical file bytes, not
allocated disk space, and linked files are excluded. If measurement is unavailable,
the page uses the Store estimate. Before downloading, review the selected
package's estimates in the confirmation dialog. **Not reported** means no size
is available; estimates can change with updates and selected content.
APFS and Mac OS Extended drives work directly. For exFAT/FAT/NTFS drives, use
**Create APFS image**. Wait for installation to finish, then press **Play**.
Not every game works; kernel anti-cheat games are unsupported. See the README's
compatibility notes.

### Per-game launch options

In a game's **Launch tools → Launch options**, put environment assignments before
`%command%` and extra game arguments after it, for example:
`CX_GRAPHICS_BACKEND=dxmt %command% --launcher-skip "two words"`.
Assignments alone also work. Quotes group literal values; variables, wildcards and
shell commands are not expanded. Custom executable wrappers are unsupported on
macOS and stop the launch with an error. Managed prefix and service variables
cannot be overridden.

Options apply to this launch only, without changing the shared bottle or another
game's settings. Per-game assignments override profile defaults and inherited
values; the **DLSS** toggle still controls its own flags, including in `CX_ENV`.
Graphics requests only work when the selected engine supports them; requesting
DXMT does not add missing FEX backend support.

### Updates and help

Replace the app with the new `.dmg` version. Its included backend updates with
the app; there is no normal user rebuild step. Your library and settings remain
in your profile. **Settings → Language** switches between English and Italian.
For a problem, enable game logging temporarily and review the log before sharing
it in a [MACxus issue](https://github.com/fladnaG86/MACxus/issues). Never share account
tokens, Keychain contents, game files or saves.

## Italiano

Questi passi valgono per le release con il backend Apple Silicon incluso.
Le beta fino alla `0.3.11-mac.3` richiedevano la compilazione locale: scegli una
release le cui note indicano il backend incluso. Per compilare dal sorgente,
consulta [la guida per sviluppatori](MAC-BACKEND.md).

### 1. Controlla il Mac

Servono un Mac Apple Silicon (M1 o successivo), Rosetta 2 e CrossOver 26.x in
`/Applications`. CrossOver è a pagamento, con una prova gratuita, ed è un'app
nativa: installa esplicitamente Rosetta per i giochi Windows. Apri **Terminale**,
incolla il comando e premi Invio (accetta la licenza Rosetta di Apple):

```sh
softwareupdate --install-rosetta --agree-to-license
```

### 2. Installa MACxus

Scarica il `.dmg` Apple Silicon dalle
[release](https://github.com/fladnaG86/MACxus/releases), aprilo e trascina MACxus in
Applicazioni. La beta non è firmata. Prova ad aprirla una volta, poi vai in
**Impostazioni di Sistema → Privacy e sicurezza → Apri comunque**. In alternativa,
apri Terminale ed esegui questo comando per l'app appena installata:

```sh
xattr -dr com.apple.quarantine /Applications/MACxus.app
```

Il backend Xodus è incluso e diventa pronto automaticamente. **Non servono
Homebrew, Git, Rust o protoc**, né un certificato di firma locale. Se il backend
incluso non supera la verifica, reinstalla l'app dalla release invece di installare
strumenti di sviluppo.

### 3. Installa il runtime e accedi

In **Impostazioni**, scegli **Installa runtime Nexus** se non è selezionato alcun
runtime. MACxus lo verifica e lo installa. Puoi anche installare il motore Wine
**Highball** per i giochi D3D12/Unreal supportati; CrossOver resta il predefinito.

**Motore Wine** rileva anche CrossOver Preview in Applicazioni. Scegli **Preview
(Rosetta)** per la build normale o **Preview (FEX/ARM)** per quella ARM64. Ogni
modalità Preview usa una bottle separata. L'opzione FEX è disponibile quando è
presente il motore ARM64; la compatibilità può differire da Rosetta. Usa
**Aggiorna rilevamento motori** dopo aver installato o aggiornato Preview.
Highball richiede ancora CrossOver normale per le librerie grafiche.

Scegli **Accedi con Xodus**. L'accesso avviene nella finestra di MACxus: Chrome non
serve. Usa la password Microsoft, un codice o l'app Authenticator. Le passkey non
sono ancora supportate su macOS: scegli **Altri modi per accedere** se Microsoft
ne richiede una. Devi possedere il gioco o avere un abbonamento PC Game Pass adatto.

### Richieste di accesso al Portachiavi

Xodus conserva le credenziali del dispositivo e dell’account nel Portachiavi di
macOS. Possono comparire richieste distinte per ogni voce e per `xodus-cli` e
`xodus-service`. Per un’installazione verificata di MACxus, **Consenti sempre**
memorizza il permesso per quell’eseguibile e quella voce; **Consenti** vale per
la richiesta corrente. Un Portachiavi bloccato può comunque richiedere lo sblocco.

I backend beta con firma ad-hoc possono richiedere nuovamente il permesso dopo
un aggiornamento dei binari. Chi prepara la release può usare la
[firma stabile del backend](MAC-BACKEND.md#optional-stable-backend-signing).
Creare un certificato locale e riavviare l’app confezionata non modifica le firme
incluse. Il primo passaggio a una build firmata può richiedere nuovi permessi.
Non occorre eliminare credenziali, disattivare la protezione del Portachiavi o
consentire l’accesso a tutte le applicazioni.

### 4. Installa un gioco

Scegli un gioco da **La mia libreria** o **Negozio**, poi il disco e la cartella.
Le schede della libreria e le pagine dei giochi mostrano la stima Microsoft del
download, se disponibile. Prima di scaricare, controlla le stime del download e
della dimensione installata nella conferma del pacchetto. **Non indicata** significa
che lo Store non ha fornito quella dimensione; le stime possono cambiare con gli
aggiornamenti e i contenuti selezionati.
I dischi APFS e Mac OS esteso funzionano direttamente. Per exFAT/FAT/NTFS usa
**Crea immagine APFS**. Attendi la fine dell'installazione e premi **Gioca**.
Non tutti i giochi funzionano; gli anti-cheat a livello kernel non sono supportati.
Consulta le note di compatibilità nel README.

### Opzioni di avvio per gioco

In **Strumenti di avvio → Opzioni di avvio** del gioco, inserisci le variabili prima
di `%command%` e gli argomenti aggiuntivi dopo, per esempio:
`CX_GRAPHICS_BACKEND=dxmt %command% --launcher-skip "due parole"`.
Puoi anche usare solo assegnazioni di variabili. Le virgolette raggruppano valori
letterali: variabili, caratteri jolly e comandi shell non vengono espansi. I wrapper
eseguibili personalizzati non sono supportati su macOS e bloccano l'avvio con un
errore. Le variabili gestite del prefisso e del servizio non sono modificabili.

Le opzioni valgono solo per questo avvio, senza modificare la bottle condivisa o
le impostazioni degli altri giochi. Le assegnazioni del gioco prevalgono sui
profili e sui valori ereditati; l'opzione **DLSS** controlla comunque i propri flag,
anche in `CX_ENV`. Le richieste grafiche funzionano solo se il motore scelto le
supporta: richiedere DXMT non aggiunge il supporto backend mancante a FEX.

### Aggiornamenti e aiuto

Sostituisci l'app con la nuova versione `.dmg`. Il backend incluso si aggiorna
insieme all'app: normalmente non devi ricompilarlo. Libreria e impostazioni restano
nel tuo profilo. **Impostazioni → Lingua** permette di scegliere inglese o italiano.
Per un problema, attiva temporaneamente i log e rileggili prima di allegarli a una
[issue MACxus](https://github.com/fladnaG86/MACxus/issues). Non condividere token,
contenuti del Portachiavi, file dei giochi o salvataggi.
