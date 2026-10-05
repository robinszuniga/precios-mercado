import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// Las pruebas corren en paralelo (incluida la de Postgres, que usa mucho procesador) y en servidores lentos: el margen por
// defecto de 1 s para `findBy`/`waitFor` da falsos fallos. Una prueba que de verdad falla igual falla, solo tarda más en decirlo.
configure({ asyncUtilTimeout: 5000 })

afterEach(() => cleanup())
