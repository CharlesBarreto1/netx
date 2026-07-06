// Módulo network — NAS (NetworkEquipment) e POPs. Os DTOs do OSP v1
// (optical/fiber/kml/power-budget/pon-tree/topology/folders) foram aposentados
// junto com o módulo `optical` — a planta externa agora é o FiberMap
// (packages/shared/src/fibermap).
export * from './equipment.dto';
export * from './pop.dto';
