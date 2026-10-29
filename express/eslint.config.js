import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

// Se corre desde fiscalo/: `eslint -c express/eslint.config.js express`.
// Con -c, ESLint evalúa `files` e `ignores` contra el directorio de trabajo (fiscalo/) y no contra
// la carpeta de este archivo, por eso todos los patrones llevan el prefijo `express/`.
// El eslint.config.js de la raíz ignora `express/`: cada app se revisa con sus propias reglas.

// Piso de navegadores: Chrome y WebView 90, Safari e iOS 14.5. Con lib ES2020 el tipado ya rechaza
// `findLast`, `findLastIndex` y `Object.hasOwn`, pero no `at` (lo declara @types/node) ni
// `structuredClone` y `crypto.randomUUID` (los declara lib.dom): para esos tres solo frenan estos selectores.
const llamadaA = (metodo, alternativa) => ({
  selector: `CallExpression[callee.computed=false][callee.property.name='${metodo}']`,
  message: `.${metodo}() no existe en Chrome 90 ni en Safari 14: ${alternativa}`,
})

const APIS_FUERA_DEL_PISO = [
  llamadaA('at', 'usa a[a.length - 1] o a.slice(-1)[0].'),
  llamadaA('findLast', 'recorre al revés con un for.'),
  llamadaA('findLastIndex', 'recorre al revés con un for.'),
  {
    selector: "CallExpression[callee.object.name='Object'][callee.property.name='hasOwn']",
    message: 'Object.hasOwn no existe en Chrome 90 ni en Safari 14: usa Object.prototype.hasOwnProperty.call(o, k).',
  },
  {
    selector: "CallExpression:matches([callee.name='structuredClone'], [callee.property.name='structuredClone'])",
    message: 'structuredClone no existe en Chrome 90 ni en Safari 14: copia a mano, o con JSON.parse(JSON.stringify(x)) si el valor es JSON puro.',
  },
  llamadaA('randomUUID', 'arma el UUID con crypto.getRandomValues.'),
]

export default tseslint.config(
  { ignores: ['express/dist', 'express/tests/fixtures/**'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['express/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/consistent-type-imports': 'error',

      // Con el storage bloqueado (ventana privada) o lleno, localStorage lanza: todo pasa por lib/almacen.
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'Usa lib/almacen: con el storage bloqueado o lleno, localStorage lanza.' },
        { name: 'sessionStorage', message: 'Usa lib/almacen: con el storage bloqueado o lleno, sessionStorage lanza.' },
      ],
      'no-restricted-syntax': ['error', ...APIS_FUERA_DEL_PISO],

      // Aislamiento: de fiscalo/src solo entran las rutas exactas permitidas (las vigila también check-graph).
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/api',
              message: 'El barril trae todo el cliente de la app completa: importa la hoja exacta, por ejemplo @/api/http.',
            },
            {
              name: '@/lib/date',
              importNames: ['hoyLocal', 'ahoraLocal'],
              message: 'usa hoy() de lib/reloj',
            },
          ],
          patterns: [
            {
              group: ['@/components/**'],
              message: 'Los componentes de la app completa no entran a Express: usa los de ~/ui.',
            },
            {
              group: ['@/pos/*', '!@/pos/montos'],
              message: 'Del POS solo se importa @/pos/montos.',
            },
          ],
        },
      ],
    },
  },
  {
    // El único lugar que toca localStorage, y las pruebas, que lo falsean.
    files: ['express/src/lib/almacen.ts', 'express/tests/**'],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    // Las pruebas usan `as any` a propósito (entradas inválidas, globales falseados).
    files: ['express/tests/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
)
