import type { Locale, StreetNameLists } from '../types';

export const STREET_NAMES: Readonly<Record<Locale, StreetNameLists>> = {
  es: {
    prefixes: ['Calle', 'Calle', 'Calle', 'Paseo', 'Camino'],
    avenues: ['Avenida de la Constitución', 'Avenida del Puerto', 'Avenida Libertad', 'Gran Vía', 'Avenida de los Álamos', 'Avenida Central', 'Avenida del Mar', 'Avenida de la Paz', 'Avenida Norte', 'Avenida Insurgentes', 'Avenida Reforma', 'Avenida Juárez', 'Avenida Universidad', 'Avenida de las Palmas', 'Avenida del Río'],
    streets: ['Mayor', 'del Sol', 'de la Luna', 'Real', 'Nueva', 'del Carmen', 'de los Olivos', 'Cervantes', 'Hidalgo', 'Morelos', 'Zaragoza', 'Allende', 'Aldama', 'Matamoros', 'Abasolo', 'Guerrero', 'Independencia', 'Victoria', 'Colón', 'Bolívar', 'San Martín', 'Sarmiento', 'Rivadavia', 'Belgrano', 'de la Fuente', 'del Molino', 'de la Rosa', 'del Prado', 'de la Sierra', 'del Roble', 'de los Sauces', 'Jazmín', 'Azucena', 'Girasol', 'del Nogal', 'Lerdo', 'Ocampo', 'Bravo', 'Galeana', 'Mina'],
    alleys: ['Callejón del Gato', 'Callejón de la Cruz', 'Callejón del Beso', 'Pasaje Sol', 'Pasaje Luna', 'Callejón del Aire', 'Callejón Angosto', 'Pasaje Norte', 'Callejón de la Amargura', 'Pasaje del Reloj'],
    districts: ['Centro', 'La Ribera', 'San Pedro', 'El Mirador', 'Las Lomas', 'Chapultepec', 'La Merced', 'Santa Fe', 'El Prado', 'Polanco', 'La Villa', 'Roma'],
  },
  en: {
    prefixes: ['', '', '', 'Old', 'New'],
    avenues: ['Broadway', 'Park Avenue', 'Grand Avenue', 'Lincoln Avenue', 'Central Avenue', 'Ocean Avenue', 'Union Avenue', 'Market Street', 'Liberty Avenue', 'Washington Avenue', 'Harbor Boulevard', 'Sunset Boulevard', 'Commerce Avenue', 'Riverside Drive', 'Northern Avenue'],
    streets: ['Main Street', 'Oak Street', 'Elm Street', 'Maple Street', 'Pine Street', 'Cedar Street', 'Walnut Street', 'Chestnut Street', 'Church Street', 'Mill Street', 'High Street', 'King Street', 'Queen Street', 'Bridge Street', 'Water Street', 'Spring Street', 'Hill Street', 'Lake Street', 'Prospect Street', 'Franklin Street', 'Jefferson Street', 'Madison Street', 'Adams Street', 'Monroe Street', 'Jackson Street', 'Willow Street', 'Birch Street', 'Ash Street', 'Poplar Street', 'Sycamore Street', 'Vine Street', 'Center Street', 'Front Street', 'Court Street', 'School Street', 'Pearl Street', 'Cherry Street', 'Laurel Street', 'Grove Street', 'Meadow Lane'],
    alleys: ['Cat Alley', 'Cross Alley', 'Bakers Lane', 'Mews Lane', 'Tanner Alley', 'Cooper Lane', 'Smith Alley', 'Post Lane', 'Well Alley', 'Clock Lane'],
    districts: ['Downtown', 'Riverside', 'Old Town', 'Hillcrest', 'Westside', 'Harbor', 'Midtown', 'Eastgate', 'Parkside', 'Northfield', 'Southbank', 'Uptown'],
  },
};

export const DISTRICT_NAMES: Readonly<Record<Locale, readonly string[]>> = {
  es: STREET_NAMES.es.districts,
  en: STREET_NAMES.en.districts,
};
