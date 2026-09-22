# Patient Portal

The Vue application served at `/patient-portal`. Built with Vite; the build output goes to
`healthcare/public/frontend`, and `healthcare/www/patient-portal/index.py` resolves the hashed
asset names through that build's `manifest.json`.

## Translating the portal

The portal reads the same translation catalogs as the rest of Frappe. Nothing portal-specific has
to be maintained: a string wrapped in `__()` is translated from the site's active language.

### How a string reaches the browser

1. `healthcare/www/patient-portal/index.py` calls `get_all_translations(lang)` for the logged-in
   user's language and passes it to the template, along with the language code itself.
2. `index.html` writes both onto `window` as `translated_messages` and `portal_lang`.
3. `patient_portal.js` hands the messages to frappe-ui via `setConfig('translatedMessages', …)`.
4. `src/translation.js` registers `__()` as a global property and on `window`, so components can
   call it from templates and from script blocks.

### Adding a translatable string

Wrap the visible text in `__()`:

```vue
<p>{{ __('Book an Appointment') }}</p>
```

With a placeholder, pass the values as an array:

```vue
<p>{{ __('Page {0} of {1}', [currentPage, totalPages]) }}</p>
```

Guard an optional value at the call site rather than relying on the formatter — an `undefined`
replacement leaves the literal `{0}` on screen:

```vue
<p v-if="order.ref_practitioner">{{ __('Ordered by: {0}', [order.ref_practitioner]) }}</p>
```

For a term whose meaning depends on where it appears, pass a context as the third argument:

```js
__('Open', null, 'appointment status')
```

**Do not wrap internal values.** DocType names, API parameters, status values used in comparisons
and the keys of a status-to-color map must stay untranslated, or the comparison breaks in every
language but English. Translate only what is displayed.

### Adding the translations themselves

Portal strings live in the same catalogs as every other string in the app, so a translator adds
them the usual way:

- **Per site, no deployment** — create a `Translation` record in Desk (Source Text, Language,
  Translated Text). Useful for one-off wording changes and for testing.
- **Shipped with an app** — add a row to that app's `translations/<lang>.csv`. Translations from
  every installed app are merged, so a downstream app can translate portal strings without
  changing this repo.
- **This repo's own catalog** — `healthcare/locale/main.pot` is regenerated on a schedule by
  `.github/workflows/generate-pot-file.yml`; new `__()` strings are picked up automatically after
  merge and do not need to be added by hand in a pull request.

### Dates, times and locale

Do not hardcode a locale. `getLocale()` in `src/translation.js` returns the active Frappe
language, falling back to the browser's:

```js
import { getLocale } from '@/translation'

new Date(dateStr).toLocaleDateString(getLocale(), { month: 'long', day: 'numeric' })
```

Month and weekday names come from `Intl` and follow the same locale; they are not translated
through `__()`. The calendar's weekday header is generated from `Intl.DateTimeFormat`, so nothing
about it needs a catalog entry.

### Checking a translation

Set your user's language in Desk (**My Settings → Language**), reload `/patient-portal`, and
confirm the strings change. Right-to-left languages need no extra work: the page extends
`templates/web.html`, so it inherits the framework's `dir` handling.

## Tests

```sh
cd patient_portal
yarn install
yarn test
```

`src/translation.spec.js` covers the localization mechanism against a non-English catalog:
lookup, context keys, placeholder substitution, the source-string fallback, and locale
resolution. `.github/workflows/portal-tests.yml` runs it on every pull request that touches
`patient_portal/`.

It exercises `translation.js` directly with a stubbed `frappe-ui` config, so it does not cover
the wiring in `patient_portal.js` or any component's rendering — a component test harness would
be needed for that.
