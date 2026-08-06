-- On-demand: hasta cuándo el paciente está dispuesto a esperar.
--
-- La cuenta regresiva de la ventana de autorización vivía SÓLO en el estado de
-- React (`secondsLeft` en OnDemand.jsx). Un refresh — o volver a la pestaña
-- después de que el navegador la suspendiera — perdía todo y devolvía al
-- paciente a "Pagar e iniciar consulta" **con la pre-autorización ya hecha**:
-- el camino directo a autorizar dos veces la misma consulta.
--
-- Con el vencimiento en la base, la pantalla se rehidrata sola (cuánto falta se
-- calcula contra este timestamp, no contra un contador en memoria) y el barrido
-- de `mp-capture` deja de cancelar a los 10 minutos fijos: respeta lo que el
-- paciente pidió cuando toca "Necesito más tiempo".
--
-- NULL = comportamiento anterior (10 minutos desde `created_at`), que es lo que
-- corresponde para todas las filas que ya existen y para cualquier consulta que
-- no sea on-demand.
alter table public.consultations
  add column if not exists ondemand_wait_until timestamptz;

comment on column public.consultations.ondemand_wait_until is
  'On-demand: hasta cuándo esperar al profesional antes de liberar la pre-autorización. Lo escribe el paciente al autorizar y al pedir más tiempo. NULL = el default histórico de 10 minutos desde created_at. El tope duro lo pone el barrido de mp-capture, no este campo.';
