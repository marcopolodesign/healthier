/**
 * La regla de firma de la historia clínica, una sola para la videollamada y
 * /profesional/historia-clinica: sin matrícula cargada no se escribe (antes la
 * videollamada firmaba con '0' y la historia clínica con 'otra'/'0').
 */
export const MENSAJE_SIN_MATRICULA = 'Falta tu matrícula en el perfil: cargala antes de escribir en la historia clínica.'
