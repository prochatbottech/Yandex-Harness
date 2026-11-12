export const weatherTool = {
  name: "get_weather_contrib",
  description: "Пользовательский инструмент: получение текущей погоды в городе (демонстрация tools-contrib)",
  brief: "get_weather_contrib(city: string) — узнать погоду",
  risk: "low",
  schema: {
    type: "object",
    properties: {
      city: {
        type: "string",
        description: "Название города (например: Москва, Санкт-Петербург, Казань)"
      }
    },
    required: ["city"]
  },
  async run(args) {
    const city = String(args.city || "Москва");
    const temperatures = {
      "Москва": "+5°C, облачно с прояснениями, ветер 3 м/с",
      "Санкт-Петербург": "+3°C, небольшой дождь, влажность 85%",
      "Казань": "+4°C, переменная облачность"
    };

    const info = temperatures[city] || `+6°C, ясно (демо-данные для ${city})`;
    return {
      content: `Погода в городе ${city}: ${info}`
    };
  }
};

export default weatherTool;
