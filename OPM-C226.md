# Cotización OPM-C226

## Información general

| Campo | Valor |
| --- | --- |
| Cotización | OPM-C226 |
| Cliente | Operadora de Pagos Móviles de México |
| RFC | OPM110928T14 |
| Fecha de creación | 01/06/2026 |
| Fecha de expiración | 01/09/2026 |
| Proyecto | Módulo de Dispersiones SPEI |

## Producto

| Nombre del producto | Cantidad | Precio unitario | Subtotal |
| --- | ---: | ---: | ---: |
| Rate-Limiting por Endpoint/Integrador | 1 | $297,666.00 MXN | $297,666.00 MXN |

## Descripción

Permite controlar cuántas peticiones puede hacer cada integrador a cada operación del API de MDO en un periodo de tiempo, protegiendo la plataforma contra abuso, picos de tráfico y errores de integración. El administrador puede definir valores por defecto para todos, ajustarlos cliente por cliente, y deshabilitar operaciones específicas para un cliente, todo desde el dashboard, sin necesidad de programación ni despliegues.

Todos los endpoints se evalúan en un punto central, por lo que los nuevos endpoints que se desarrollen a futuro también podrán limitarse sin desarrollo adicional. El dashboard incluye un descubridor automático de endpoints que permite configurarlos todos, incluidos los que se agreguen después.

## Alcance del Desarrollo

### Motor de límites (Backend)

- Evaluación centralizada de todos los endpoints en un único punto: los endpoints que se desarrollen a futuro quedan automáticamente sujetos a límites sin desarrollo adicional.
- Conteo de peticiones por cliente, por operación y por tipo de acción (consulta/alta/modificación/borrado).
- Límites por ventana de tiempo configurable (por minuto/hora) con respuesta estándar al excederse.
- Funcionamiento correcto con múltiples servidores en paralelo (conteo centralizado en Redis).
- Detección automática del catálogo de endpoints disponibles del sistema.

### Configuración y reglas

- Valores por defecto globales administrables.
- Sobrescritura de límites por cliente individual.
- Jerarquía de reglas (lo específico del cliente gana sobre el valor por defecto).
- Interruptor para habilitar/deshabilitar cualquier operación por cliente.

### Panel de Administración (Frontend MDO)

- Descubridor automático de endpoints: lista y permite configurar todos los endpoints del sistema, incluidos los que se agreguen a futuro.
- Pantalla de gestión de valores por defecto globales.
- Pantalla de gestión de límites y excepciones por cliente.
- Selector de operación basado en el catálogo real del sistema.
- Vista de la configuración efectiva (resuelta) por cliente.
- Activar/desactivar operaciones con un clic.
- Tabla de estádisticas en tiempo real de uso del API por cliente.

### Seguridad y operación

- Acceso restringido a administradores.
- Nuevos permisos para gestión de límites.
- Registro de peticiones rechazadas para diagnóstico.

## Parámetros funcionales

| Campo | Descripción | Ejemplo |
| --- | --- | --- |
| Límites por defecto | Cuántas peticiones permitir por operación y ventana para clientes nuevos. | 10 req / segundo |
| Operaciones críticas | Operaciones que NO deben poder deshabilitarse nunca. | health, webhook SPEI |
| Acción al exceder | Código de respuesta deseado al superar el límite. | 429 (recomendado) |
| Excepciones por cliente | Clientes con necesidades distintas al default. | Cliente X: 500 req/min |

## Parámetros técnicos

| Campo | Descripción | Default |
| --- | --- | --- |
| limit_count | Nº de peticiones permitidas en la ventana. | 100 |
| window_seconds | Duración de la ventana de conteo (segundos). | 60 |
| http_verb | Verbo al que aplica la regla (vacío = todos). | (todos) |
| enabled | Operación habilitada/deshabilitada para el cliente. | habilitado |
| product_id | Cliente al que aplica (vacío = valor por defecto global). | (default) |

## Totales

| Concepto | Importe |
| --- | ---: |
| Subtotal | $297,666.00 MXN |
| IVA | $47,626.56 MXN |
| Total | $345,292.56 MXN |

## Contacto

Julio Ruelas, 45, San José Insurgentes, Benito Juarez, CDMX, CDMX, 03900  
mark@tide.mx
