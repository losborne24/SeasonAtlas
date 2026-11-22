import { getClimateMonth, WeatherError } from "@/lib/weather/server";
import { WEATHER_DATASET } from "@/lib/weather/climate";

export const maxDuration = 120;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.has("dataset") && params.get("dataset") !== WEATHER_DATASET) {
    return Response.json({ error: "Weather dataset has changed. Please reload." }, { status: 400 });
  }
  const parse = (name: string) => {
    const text = params.get(name);
    return text?.trim() ? Number(text) : NaN;
  };
  const latitude = parse("latitude"), longitude = parse("longitude"), month = parse("month");
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180 || !Number.isInteger(month) || month < 1 || month > 12) {
    return Response.json({ error: "Enter valid latitude, longitude and month (1–12)." }, { status: 400 });
  }
  try {
    const data = await getClimateMonth(Number(latitude.toFixed(4)), Number(longitude.toFixed(4)), month);
    return Response.json(data, { headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800" } });
  } catch (error) {
    const known = error instanceof WeatherError;
    const status = known ? error.status : 500;
    return Response.json({ error: known ? error.message : "Historical weather could not be loaded." }, {
      status, headers: { "Cache-Control": "no-store", ...(status === 429 || status === 503 ? { "Retry-After": "60" } : {}) },
    });
  }
}
