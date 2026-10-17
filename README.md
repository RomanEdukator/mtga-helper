# MTGA Helper (Windows)

Lokalna nakładka na MTG Arena, która w trakcie draftu pokazuje karty z aktualnego packa
posortowane według oceny 1-5 (na podstawie win rate z 17Lands).

## Wymagania
- Windows, Node.js 18+
- W MTG Arena: Opcje → Konto → **Detailed Logs (Plugin Support)** włączone
- Gra w trybie **okienkowym** lub **okienkowym bez ramek** (w pełnym ekranie nakładka się nie pokaże)

## Uruchomienie
```
npm install
npm run ratings -- DSK        # zamień DSK na kod aktualnego setu
copy config.example.json config.json   # i ustaw "set"
npm start
```

`Ctrl+Shift+O` pokazuje/ukrywa nakładkę.

## Testy
```
npm test
```

## Do zweryfikowania na prawdziwym logu
- Wzorce w `src/logParser.js` (`PackCards`, `DraftPack`) trzeba potwierdzić na realnym `Player.log`
  podczas draftu. Jeśli Wizards zmienił format, popraw tylko ten plik.
- Endpoint 17Lands w `scripts/build-ratings.js` jest nieoficjalny. Sprawdź warunki użycia danych.

## Plan dalej
1. Premia za kolory i krzywą many (ocena zależna od dotychczasowych pików)
2. Autobudowa talii po drafcie
3. Warstwa SI (komentarze, warianty talii)
4. Tracker meczu (talia, biblioteka, prawdopodobieństwa dobrania)
