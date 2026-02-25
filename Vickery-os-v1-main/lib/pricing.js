const pricingTable = {
  recessedLight: {
    labor: 75,
    material: 50,
  },
};

function calculateRecessedLights(qty) {
  const unit = pricingTable.recessedLight;
  const unitTotal = unit.labor + unit.material;

  return {
    service: "recessedLight",
    qty,
    laborPerUnit: unit.labor,
    materialPerUnit: unit.material,
    unitTotal,
    total: unitTotal * qty,
  };
}

module.exports = { calculateRecessedLights };