"use client";
import { useEffect, useRef, useState } from "react";
import { callApi, statusLabel } from "../api";
import RouteMap from "./RouteMap";

const CLASSES = [
  { id: "economy", label: "Эконом", icon: "🚕" },
  { id: "comfort", label: "Комфорт", icon: "🚘" },
  { id: "comfort_plus", label: "Комфорт+" , icon: "✨" },
  { id: "business", label: "Бизнес", icon: "🖤" },
  { id: "minivan", label: "Минивэн", icon: "🚐" },
  { id: "premium", label: "Премиум", icon: "⭐" },
];

const TARIFF_IMAGES = {
  economy: "https://toppng.com/uploads/preview/rexton-colours-car-png-hd-white-11563538722bh2k9z7s9u.png",
  comfort: "https://toppng.com/uploads/preview/rexton-colours-car-png-hd-white-11563538722bh2k9z7s9u.png",
  comfort_plus: "https://pub-d7dd69091bea4f32b4e9e4801456c86c.r2.dev/images/suv-preto-moderno-e-elegante-png/preview.webp",
  business: "https://toppng.com/public/uploads/preview/mercedes-logo-png-transparent-background-116604284845alexjibor.png",
  minivan: "https://narvakrown.ee/upload/iblock/8ed/zc29pxujhyj77afnuvuacq3qllfloaqs.png",
  premium: "https://toppng.com/public/uploads/preview/mercedes-logo-png-transparent-background-116604284845alexjibor.png",
};


const PASSENGER_I18N_ROWS = [
  ["Мой Такси","Мой Такси","My Taxi"],["Карта поездки","Сапар картасы","Trip map"],["Карта Астаны","Астана картасы","Astana map"],
  ["Местоположение определено","Орналасқан жер анықталды","Location detected"],["Определяем местоположение…","Орналасқан жерді анықтап жатырмыз…","Detecting location…"],
  ["Как вас зовут?","Атыңыз кім?","What's your name?"],["Ваше имя","Атыңыз","Your name"],["Телефон","Телефон","Phone"],["Изменить","Өзгерту","Edit"],
  ["Куда едем?","Қайда барамыз?","Where to?"],["ВАША ПОЕЗДКА","СІЗДІҢ САПАРЫҢЫЗ","YOUR RIDE"],["ЗАКАЗ ТАКСИ","ТАКСИГЕ ТАПСЫРЫС","BOOK A TAXI"],
  ["Астана","Астана","Astana"],["Откуда","Қайдан","Pickup"],["Куда","Қайда","Destination"],
  ["Моё местоположение или адрес","Менің орналасқан жерім немесе мекенжай","My location or address"],
  ["Адрес, улица или место","Мекенжай, көше немесе орын","Address, street or place"],["Моё местоположение","Менің орналасқан жерім","My location"],
  ["Точка подачи выбрана","Отырғызу орны таңдалды","Pickup point selected"],["Выбери адрес из подсказок","Ұсыныстардан мекенжайды таңдаңыз","Choose an address suggestion"],
  ["Можно указать адрес вручную","Мекенжайды қолмен енгізуге болады","You can enter an address manually"],["Ищем адреса…","Мекенжайларды іздеп жатырмыз…","Searching addresses…"],
  ["Поменять адреса местами","Мекенжайлардың орнын ауыстыру","Swap addresses"],["Выберите тариф","Тарифті таңдаңыз","Choose a ride class"],
  ["Подробнее о тарифах","Тарифтер туралы толығырақ","About ride classes"],["О тарифах","Тарифтер туралы","About fares"],
  ["Стоимость рассчитывается по выбранному маршруту и классу автомобиля. После отправки заказа водитель может принять предложенную сумму или предложить встречную цену.","Құны таңдалған бағыт пен көлік класы бойынша есептеледі. Тапсырыс жіберілгеннен кейін жүргізуші ұсынылған бағаны қабылдай алады немесе өз бағасын ұсына алады.","The fare is calculated from the selected route and vehicle class. After you send the request, a driver can accept your price or make a counteroffer."],
  ["Эконом","Эконом","Economy"],["Комфорт","Комфорт","Comfort"],["Комфорт+","Комфорт+","Comfort+"],["Бизнес","Бизнес","Business"],["Минивэн","Минивэн","Minivan"],["Премиум","Премиум","Premium"],
  ["Нет цены","Баға жоқ","No price"],["Сейчас водители класса","Қазір осы кластағы жүргізушілер","Drivers in this class are currently"],
  ["не на линии. Заказ сохранится; водители увидят его, когда выйдут на линию.","желідегі жоқ. Тапсырыс сақталады; жүргізушілер желіге шыққанда оны көреді.","not online. Your request will be saved and drivers will see it when they come online."],
  ["Предложите свою цену","Өз бағаңызды ұсыныңыз","Offer your price"],["Водители могут принять её или предложить свою","Жүргізушілер оны қабылдай алады немесе өз бағасын ұсына алады","Drivers can accept it or make their own offer"],
  ["Меняй цену шагом 50 ₸","Бағаны 50 ₸ қадамымен өзгертіңіз","Adjust the price in 50 ₸ steps"],["Цена появится после расчёта маршрута","Баға бағыт есептелгеннен кейін шығады","Price appears after the route is calculated"],
  ["Уменьшить цену на 50 тенге","Бағаны 50 теңгеге азайту","Decrease price by 50 tenge"],["Увеличить цену на 50 тенге","Бағаны 50 теңгеге арттыру","Increase price by 50 tenge"],
  ["Способ оплаты","Төлем тәсілі","Payment method"],["Наличные","Қолма-қол ақша","Cash"],["Kaspi перевод","Kaspi аударымы","Kaspi transfer"],["Kaspi","Kaspi","Kaspi"],
  ["Пожелания водителю","Жүргізушіге арналған ескертулер","Notes for the driver"],["необязательно","міндетті емес","optional"],["Подъезд, ориентир или другие пожелания…","Кіреберіс, бағдар немесе басқа ескертулер…","Entrance, landmark, or other notes…"],
  ["Предложить цену","Баға ұсыну","Offer price"],["Отправить водителям","Жүргізушілерге жіберу","Send to drivers"],["Быстрый заказ","Жылдам тапсырыс","Quick request"],["По расчётной цене","Есептелген бағамен","At the estimated price"],
  ["Тестовый режим: списания не выполняются.","Сынақ режимі: ақша алынбайды.","Test mode: no charges are made."],
  ["Главная","Басты бет","Home"],["Мои поездки","Сапарларым","My rides"],["Чаты","Чаттар","Chats"],["Профиль","Профиль","Profile"],
  ["Ищем водителя","Жүргізушіні іздеп жатырмыз","Finding a driver"],["Водитель едет к вам","Жүргізуші сізге келе жатыр","Driver is on the way"],
  ["Водитель на месте","Жүргізуші келді","Driver has arrived"],["Поездка началась","Сапар басталды","Ride started"],["Новый заказ","Жаңа тапсырыс","New request"],
  ["Пассажир выходит","Жолаушы шығып келеді","Passenger is coming out"],["Поездка завершена","Сапар аяқталды","Ride completed"],["Отменён","Бас тартылды","Cancelled"],
  ["Тариф","Тариф","Ride class"],["Расстояние","Қашықтық","Distance"],["Оплата","Төлем","Payment"],["Тип","Түрі","Type"],["Межгород","Қалааралық","Intercity"],["Город","Қала","City"],
  ["Автомобиль","Көлік","Vehicle"],["Водитель","Жүргізуші","Driver"],
  ["Водитель приехал за тобой. Нажми кнопку, когда подходишь к машине.","Жүргізуші келді. Көлікке жақындағанда батырманы басыңыз.","Your driver has arrived. Tap the button when you are approaching the car."],
  ["Я выхожу","Шығып келемін","I'm coming out"],["Ты сообщил водителю, что выходишь.","Жүргізушіге шығып келе жатқаныңызды хабарладыңыз.","You've told the driver you're coming out."],
  ["Садись в автомобиль; водитель начнёт поездку после посадки.","Көлікке отырыңыз; жүргізуші отырғаннан кейін сапарды бастайды.","Get in the car; the driver will start the ride once you're seated."],
  ["Ищем водителей","Жүргізушілерді іздеп жатырмыз","Finding drivers"],
  ["Водители выбранного класса рядом получат заказ и смогут предложить свою цену.","Жақын жердегі таңдалған класс жүргізушілері тапсырысты алып, өз бағасын ұсына алады.","Nearby drivers in this class will receive the request and can offer their price."],
  ["Предложений:","Ұсыныстар:","Offers:"],["Принять","Қабылдау","Accept"],["Отклонить","Қабылдамау","Decline"],["Отменить заказ","Тапсырыстан бас тарту","Cancel request"],
  ["Открыть маршрут в 2ГИС","2GIS қолданбасында бағытты ашу","Open route in 2GIS"],["Если планы изменились, можно отменить заказ до начала поездки.","Жоспар өзгерсе, сапар басталғанға дейін тапсырыстан бас тартуға болады.","If your plans change, you can cancel before the ride begins."],
  ["Как прошла поездка?","Сапар қалай өтті?","How was your ride?"],["Оцени водителя — это поможет улучшать сервис.","Жүргізушіні бағалаңыз — бұл қызметті жақсартуға көмектеседі.","Rate your driver to help us improve the service."],
  ["Оценка от 1 до 5 звёзд","1-ден 5 жұлдызға дейін бағалау","Rate from 1 to 5 stars"],["Комментарий (необязательно)","Пікір (міндетті емес)","Comment (optional)"],
  ["Что понравилось или что улучшить?","Не ұнады немесе нені жақсарту керек?","What did you like or what could be improved?"],["Сохраняем…","Сақтап жатырмыз…","Saving…"],["Отправить оценку","Бағаны жіберу","Submit rating"],["Спасибо за оценку!","Бағаңызға рақмет!","Thanks for your rating!"],["Заказать ещё раз","Қайта тапсырыс беру","Book again"],
  ["Не удалось получить координаты GPS. Проверь разрешение местоположения для Chrome и попробуй ещё раз.","GPS координаттарын алу мүмкін болмады. Chrome қолданбасындағы орналасу рұқсатын тексеріп, қайта көріңіз.","Could not get GPS coordinates. Check Chrome's location permission and try again."],
  ["Chrome не разрешил доступ к местоположению. Нажми значок слева от адреса сайта → Разрешения → Местоположение → Разрешить. На телефоне также включи «Местоположение». Затем нажми «Моё местоположение» ещё раз.","Chrome орналасқан жерге кіруге рұқсат бермеді. Сайт мекенжайының сол жағындағы белгішені басыңыз → Рұқсаттар → Орналасқан жер → Рұқсат беру. Телефонда да «Орналасқан жер» параметрін қосыңыз. Содан кейін «Менің орналасқан жерім» түймесін қайта басыңыз.","Chrome couldn't access your location. Tap the icon beside the site address → Permissions → Location → Allow. Also enable Location on your phone, then tap My location again."],
  ["Телефон пока не смог определить координаты. Включи GPS/Местоположение и попробуй ещё раз на открытом месте.","Телефон координаттарды анықтай алмады. GPS/Орналасқан жерді қосып, ашық жерде қайта көріңіз.","Your phone couldn't determine its location. Turn on GPS/Location and try again in an open area."],
  ["GPS отвечает слишком долго. Включи «Местоположение» в телефоне и нажми кнопку ещё раз — приложение попробует получить координаты повторно.","GPS тым ұзақ жауап беріп жатыр. Телефондағы «Орналасқан жер» параметрін қосып, түймені қайта басыңыз.","GPS is taking too long. Enable Location on your phone and tap again to retry."],
  ["Используются временные тарифы. Проверь соединение перед заказом.","Уақытша тарифтер қолданылып жатыр. Тапсырыс бермес бұрын байланысты тексеріңіз.","Temporary fares are being used. Check your connection before booking."],
  ["Заказ отправлен. Тестовый режим: никаких списаний.","Тапсырыс жіберілді. Сынақ режимі: ақша алынбайды.","Request sent. Test mode: no charges."],
  ["Заказ отправлен водителям.","Тапсырыс жүргізушілерге жіберілді.","Request sent to drivers."],
  ["Предложение цены отправлено. Тестовый режим: никаких списаний.","Баға ұсынысы жіберілді. Сынақ режимі: ақша алынбайды.","Price offer sent. Test mode: no charges."],
  ["Предложение цены отправлено водителям.","Баға ұсынысы жүргізушілерге жіберілді.","Price offer sent to drivers."],
  ["Рассчитываем маршрут…","Бағытты есептеп жатырмыз…","Calculating route…"],
  ["Маршрут рассчитывается слишком долго. Проверь подключение и попробуй ещё раз.","Бағыт тым ұзақ есептеліп жатыр. Байланысты тексеріп, қайта көріңіз.","Route calculation is taking too long. Check your connection and try again."],
  ["Сервер долго не отвечает. Проверь подключение и попробуй ещё раз.","Сервер ұзақ жауап бермей жатыр. Байланысты тексеріп, қайта көріңіз.","The server is taking too long to respond. Check your connection and try again."],
  ["Не настроен ключ приложения.","Қолданба кілті бапталмаған.","The app key is not configured."],["Ошибка сервера.","Сервер қатесі.","Server error."]
];
const PASSENGER_I18N = {
  kk: Object.fromEntries(PASSENGER_I18N_ROWS.map(([ru, kk]) => [ru, kk])),
  en: Object.fromEntries(PASSENGER_I18N_ROWS.map(([ru, kk, en]) => [ru, en])),
};
function translatePassengerText(value, language) {
  const dictionary = PASSENGER_I18N[language];
  if (!dictionary || !value) return value;
  const input = String(value);
  const leading = (input.match(/^\s*/) || [""])[0];
  const trailing = (input.match(/\s*$/) || [""])[0];
  const source = input.trim();
  if (!source) return value;
  if (dictionary[source]) return leading + dictionary[source] + trailing;
  const keys = Object.keys(dictionary).filter(key => key.length >= 3).sort((a,b) => b.length - a.length);
  const escaped = keys.map(key => key.replace(/[.+?()]/g, "\\$&"));
  const pattern = new RegExp(escaped.join("|"), "g");
  return leading + source.replace(pattern, match => dictionary[match] || match) + trailing;
}

const money = value => Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₸";

function routeUrl(a, b) {
  return "https://2gis.kz/directions/points/" + a.lng + "," + a.lat + "|" + b.lng + "," + b.lat;
}
function gpsErrorMessage(error) {
  if (error?.code === 1) return "Chrome не разрешил доступ к местоположению. Нажми значок слева от адреса сайта → Разрешения → Местоположение → Разрешить. На телефоне также включи «Местоположение». Затем нажми «Моё местоположение» ещё раз.";
  if (error?.code === 2) return "Телефон пока не смог определить координаты. Включи GPS/Местоположение и попробуй ещё раз на открытом месте.";
  if (error?.code === 3) return "GPS отвечает слишком долго. Включи «Местоположение» в телефоне и нажми кнопку ещё раз — приложение попробует получить координаты повторно.";
  return "Не удалось получить координаты GPS. Проверь разрешение местоположения для Chrome и попробуй ещё раз.";
}
export default function PassengerPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [showContactFields, setShowContactFields] = useState(false);
  const [tariffInfoOpen, setTariffInfoOpen] = useState(false);
  const [uiLanguage, setUiLanguage] = useState("ru");
  const passengerLanguageTextNodes = useRef(new WeakMap());
  const passengerLanguageAttributes = useRef(new WeakMap());
  const [pickup, setPickup] = useState("");
  const [destination, setDestination] = useState("");
  const [comment, setComment] = useState("");
  const [pickupPoint, setPickupPoint] = useState(null);
  const [destinationPoint, setDestinationPoint] = useState(null);
  const [pickupSuggestions, setPickupSuggestions] = useState([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState([]);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionError, setSuggestionError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [ratingStars, setRatingStars] = useState(5);
  const [ratingComment, setRatingComment] = useState("");
  const [savingRating, setSavingRating] = useState(false);
  const [onlineClasses, setOnlineClasses] = useState(CLASSES.map(x => x.id));
  const [testMode, setTestMode] = useState(true);
  const [tripType, setTripType] = useState("city");
  const [selectedClass, setSelectedClass] = useState("economy");
  const [priceAdjustment, setPriceAdjustment] = useState(0);
  const [route, setRoute] = useState(null);
  const [order, setOrder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const routeRequestRef = useRef(false);
  const pickupManuallyChosenRef = useRef(false);
  const clientAudioRef = useRef(null);

  useEffect(() => {
    try {
      const savedLanguage = localStorage.getItem("moyTaxiPassengerLanguage") || localStorage.getItem("moyTaxiLanguage");
      if (savedLanguage === "kk" || savedLanguage === "ru" || savedLanguage === "en") setUiLanguage(savedLanguage);
    } catch {}
  }, []);

  useEffect(() => {
    const root = document.querySelector(".passenger-screen");
    if (!root) return;
    root.setAttribute("lang", uiLanguage === "kk" ? "kk" : uiLanguage === "en" ? "en" : "ru");

    const skipSelector = "script,style,.route-map-panel,.leaflet-container,.route-map,[data-map-root],svg";
    const translateNode = node => {
      if (!node || !node.nodeValue || !node.nodeValue.trim()) return;
      const parent = node.parentElement;
      if (!parent || parent.closest(skipSelector)) return;
      const cache = passengerLanguageTextNodes.current;
      const current = node.nodeValue;
      let record = cache.get(node);
      if (!record) {
        record = { source: current, last: null };
        cache.set(node, record);
      } else if (current !== record.last) {
        record.source = current;
        record.last = null;
      }
      const output = translatePassengerText(record.source, uiLanguage);
      record.last = output;
      if (current !== output) node.nodeValue = output;
    };

    const translateAttributes = element => {
      if (!element || element.closest?.(".route-map-panel,.leaflet-container,.route-map,[data-map-root],svg")) return;
      const cache = passengerLanguageAttributes.current;
      let attributes = cache.get(element);
      if (!attributes) {
        attributes = new Map();
        cache.set(element, attributes);
      }
      for (const name of ["placeholder", "aria-label", "title", "alt"]) {
        if (!element.hasAttribute(name)) continue;
        const current = element.getAttribute(name) || "";
        let record = attributes.get(name);
        if (!record) {
          record = { source: current, last: null };
          attributes.set(name, record);
        } else if (current !== record.last) {
          record.source = current;
          record.last = null;
        }
        const output = translatePassengerText(record.source, uiLanguage);
        record.last = output;
        if (current !== output) element.setAttribute(name, output);
      }
    };

    const translateTree = container => {
      if (!container) return;
      if (container.nodeType === Node.TEXT_NODE) {
        translateNode(container);
        return;
      }
      if (container.nodeType !== Node.ELEMENT_NODE && container !== root) return;
      if (container.nodeType === Node.ELEMENT_NODE && container.closest(skipSelector)) return;
      if (container.nodeType === Node.ELEMENT_NODE) translateAttributes(container);
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) translateNode(node);
      if (container.querySelectorAll) container.querySelectorAll("*").forEach(translateAttributes);
    };

    translateTree(root);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "characterData") translateNode(record.target);
        else if (record.type === "attributes") translateAttributes(record.target);
        else for (const node of record.addedNodes) translateTree(node);
      }
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["placeholder", "aria-label", "title", "alt"] });
    return () => observer.disconnect();
  }, [uiLanguage]);

  useEffect(() => {
    try {
      const profile = JSON.parse(localStorage.getItem("moyTaxiClientProfile") || "{}");
      setName(profile.name || ""); setPhone(profile.phone || "");
      setShowContactFields(!profile.name || !profile.phone);
      const saved = JSON.parse(localStorage.getItem("moyTaxiGeneralOrder") || "null");
      if (saved?.id && saved?.client_token) setOrder(saved);
    } catch {}
    callApi("public_tariffs").then(data => {
      setTestMode(data.test_mode !== false);
      if (Array.isArray(data.online_classes)) setOnlineClasses(data.online_classes);
    }).catch(() => setNotice("Используются временные тарифы. Проверь соединение перед заказом."));
    if (!navigator.geolocation) {
      setLocating(false);
      setError("Геолокация недоступна в этом браузере. Разреши местоположение в Chrome или укажи адрес подачи вручную.");
      return;
    }
    let active = true;
    const applyPosition = position => {
      if (!active || !position?.coords) return;
      const point = { lat: Number(position.coords.latitude), lng: Number(position.coords.longitude) };
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
        setLocating(false);
        setError("Телефон вернул некорректные координаты GPS. Нажми «Моё местоположение» повторно.");
        return;
      }
      setLocating(false);
      if (pickupManuallyChosenRef.current) return;
      setPickupPoint(point);
      setPickup(current => pickupManuallyChosenRef.current || (current.trim() && current !== "Моё местоположение") ? current : "Моё местоположение");
      callApi("address_reverse", point).then(result => {
        if (active && !pickupManuallyChosenRef.current) setPickup(current =>
          !current.trim() || current === "Моё местоположение" ? result.label || "Моё местоположение" : current
        );
      }).catch(() => {});
    };
    const failPosition = error => {
      if (!active) return;
      if (error?.code !== 1) {
        navigator.geolocation.getCurrentPosition(applyPosition, finalError => {
          if (!active) return;
          setLocating(false);
          setError(gpsErrorMessage(finalError));
        }, { enableHighAccuracy: false, timeout: 30000, maximumAge: 300000 });
        return;
      }
      setLocating(false);
      setError(gpsErrorMessage(error));
    };
    setLocating(true);
    navigator.geolocation.getCurrentPosition(applyPosition, failPosition, { enableHighAccuracy: true, timeout: 25000, maximumAge: 120000 });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (pickup.trim().length < 3 || pickupPoint || pickup === "Моё местоположение") {
      setPickupSuggestions([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      callApi("address_suggest", { query: pickup }).then(result => {
        if (active) setPickupSuggestions(result.suggestions || []);
      }).catch(() => { if (active) setPickupSuggestions([]); });
    }, 650);
    return () => { active = false; clearTimeout(timer); };
  }, [pickup, pickupPoint]);

  useEffect(() => {
    const clean = destination.trim();
    if (clean.length < 3 || destinationPoint) {
      setDestinationSuggestions([]);
      setSuggestionError("");
      setSuggestionLoading(false);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      setSuggestionLoading(true);
      setSuggestionError("");
      try {
        const result = await callApi("address_suggest", {
          query: clean,
          near_lat: pickupPoint?.lat ?? null,
          near_lng: pickupPoint?.lng ?? null
        });
        if (active) {
          const rows = result.suggestions || [];
          setDestinationSuggestions(rows);
          setSuggestionError(rows.length ? "" : "2ГИС не нашёл совпадений. Добавь город или уточни улицу/название объекта.");
        }
      } catch (e) {
        if (active) {
          setDestinationSuggestions([]);
          setSuggestionError(e.message || "Поиск адресов через 2ГИС недоступен. Попробуй ещё раз.");
        }
      } finally {
        if (active) setSuggestionLoading(false);
      }
    }, 650);
    return () => { active = false; clearTimeout(timer); };
  }, [destination, destinationPoint, pickupPoint?.lat, pickupPoint?.lng]);

  useEffect(() => {
    if (pickupPoint && destinationPoint && destination.trim() && !route) {
      void calculateRouteData();
    }
  }, [pickupPoint?.lat, pickupPoint?.lng, destinationPoint?.lat, destinationPoint?.lng]);

  useEffect(() => {
    const unlockAudio = () => {
      try {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!clientAudioRef.current && C) clientAudioRef.current = new C();
        if (clientAudioRef.current?.state === "suspended") void clientAudioRef.current.resume();
      } catch {}
    };
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  function playClientTone() {
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!clientAudioRef.current && C) clientAudioRef.current = new C();
      const context = clientAudioRef.current;
      if (!context) return;
      void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime;
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.14, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.21);
    } catch {}
  }

  useEffect(() => {
    if (!order?.id || !order?.client_token) return;
    let active = true;
    let previousStatus = order.status || "new";
    const load = async () => {
      try {
        const data = await callApi("order_status", { order_id: order.id, client_token: order.client_token });
        if (!active) return;
        const incomingStatus = String(data.order?.status || previousStatus);
        if (previousStatus === "new" && incomingStatus === "accepted") {
          playClientTone();
          setNotice("✅ Водитель принял заказ и едет к тебе.");
        }
        if (previousStatus !== "cancelled" && incomingStatus === "cancelled") {
          setNotice("Заказ отменён.");
        }
        previousStatus = incomingStatus;
        const updated = { ...order, ...data.order, offers: data.offers || [], rating: data.rating || null };
        setOrder(updated); localStorage.setItem("moyTaxiGeneralOrder", JSON.stringify(updated));
      } catch {}
    };
    load();
    const timer = setInterval(load, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [order?.id, order?.client_token]);

  const baseQuote = route?.estimated_prices?.[selectedClass] ?? null;
  const quote = baseQuote == null ? null : Math.max(50, Number(baseQuote) + priceAdjustment);
  function changeOfferPrice(delta) {
    if (baseQuote == null) return;
    setPriceAdjustment(current => Math.max(50, Number(baseQuote) + current + delta) - Number(baseQuote));
  }
  const driver = order?.drivers || order?.assigned_driver || null;
  const showBooking = !order || order.status === "cancelled";

  async function calculateRouteData() {
    if (routeRequestRef.current || busy) return;
    if (!pickup.trim()) { setError("Введи адрес подачи или нажми «Моё местоположение»."); return; }
    if (!destination.trim()) { setError("Введи адрес назначения."); return; }
    routeRequestRef.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await callApi("calculate_route", {
        pickup_address: pickup || "Моё местоположение",
        destination_address: destination,
        pickup_lat: pickupPoint?.lat ?? null,
        pickup_lng: pickupPoint?.lng ?? null,
        destination_lat: destinationPoint?.lat ?? null,
        destination_lng: destinationPoint?.lng ?? null,
      });
      const a = result.pickup_point;
      const b = result.destination_point;
      if (!a || !b || !Number.isFinite(Number(result.distance_km)) || !result.estimated_prices) {
        throw new Error("Маршрут рассчитать не удалось. Проверь адрес подачи и назначения.");
      }
      setPickupPoint({ lat: Number(a.lat), lng: Number(a.lng) });
      setDestinationPoint({ lat: Number(b.lat), lng: Number(b.lng) });
      setPriceAdjustment(0);
      setRoute({
        distanceKm: Number(result.distance_km),
        durationMin: Number(result.duration_minutes),
        geometry: result.route_geometry || [],
        estimated_prices: result.estimated_prices,
      });
      setTripType(Number(result.distance_km) >= 35 ? "intercity" : "city");
      if (Array.isArray(result.online_classes)) setOnlineClasses(result.online_classes);
      setPickup(current => current || "Моё местоположение");
      setNotice(result.route_notice || "");
    } catch (e) {
      setRoute(null);
      setError(e.message || "Не получилось найти этот адрес. Выбери точный адрес в подсказках ниже.");
    } finally {
      routeRequestRef.current = false;
      setBusy(false);
    }
  }
  async function calculateRoute(event) {
    event.preventDefault();
    await calculateRouteData();
  }

  async function submitOrder(mode = "offer") {
    if (!name.trim()) {
      setShowContactFields(true);
      setError("Укажи своё имя, чтобы заказать такси.");
      window.setTimeout(() => document.getElementById("moy-taxi-client-name")?.focus(), 0);
      return;
    }
    if (!phone.trim()) {
      setShowContactFields(true);
      setError("Укажи номер телефона, чтобы водитель мог с тобой связаться.");
      window.setTimeout(() => document.getElementById("moy-taxi-client-phone")?.focus(), 0);
      return;
    }
    if (!pickupPoint) { setError("Не определена точка подачи. Разреши GPS или выбери адрес подачи из подсказок."); return; }
    if (!route || !destinationPoint) { setError("Маршрут не готов. Выбери адрес назначения и нажми «Рассчитать маршрут и цены»."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const fare = Number(mode === "fast" ? (baseQuote || quote || 0) : (quote || 0));
      if (!fare) throw new Error("Не удалось рассчитать цену для этого класса. Пересчитай маршрут.");
      const result = await callApi("create_order", {
        driver_code: "AUTO", name, phone, pickup_address: pickup || "Моё местоположение",
        destination_address: destination, pickup_lat: pickupPoint.lat, pickup_lng: pickupPoint.lng,
        destination_lat: destinationPoint.lat, destination_lng: destinationPoint.lng,
        route_distance_km: route.distanceKm, vehicle_class: selectedClass, trip_type: tripType,
        payment_method: paymentMethod, client_price: fare, comment,
      });
      const saved = { ...result.order, assigned_driver: result.assigned_driver, offers: [], pickup_point: pickupPoint,
        destination_point: destinationPoint, route_distance_km: route.distanceKm, vehicle_class: selectedClass };
      setOrder(saved); localStorage.setItem("moyTaxiGeneralOrder", JSON.stringify(saved));
      localStorage.setItem("moyTaxiClientProfile", JSON.stringify({ name, phone }));
      setShowContactFields(false);
      setNotice(mode === "fast" ? "Быстрый заказ отправлен по расчётной цене." : (testMode ? "Предложение цены отправлено. Тестовый режим: никаких списаний." : "Предложение цены отправлено водителям."));
      setComment("");
    } catch (e) { setError(e.message || "Не удалось отправить заказ."); }
    finally { setBusy(false); }
  }

  async function markClientReady() {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await callApi("client_mark_ready", { order_id: order.id, client_token: order.client_token });
      const updated = { ...order, ...result.order };
      setOrder(updated); localStorage.setItem("moyTaxiGeneralOrder", JSON.stringify(updated));
      setNotice("Водитель получил сообщение: ты выходишь.");
    } catch (e) { setError(e.message || "Не удалось сообщить водителю."); }
    finally { setBusy(false); }
  }
  async function submitRating() {
    if (!order?.id || order?.rating?.id) return;
    setSavingRating(true); setError(""); setNotice("");
    try {
      const result = await callApi("client_rate_driver", { order_id: order.id, client_token: order.client_token, stars: ratingStars, comment: ratingComment });
      const updated = { ...order, rating: result.rating };
      setOrder(updated); localStorage.setItem("moyTaxiGeneralOrder", JSON.stringify(updated));
      setNotice("Спасибо! Оценка водителя сохранена.");
    } catch (e) { setError(e.message || "Не удалось сохранить оценку."); }
    finally { setSavingRating(false); }
  }
  async function cancelOrder() {
    if (!order?.id) return;
    setBusy(true); setError("");
    try {
      const result = await callApi("cancel_order", { order_id: order.id, client_token: order.client_token });
      const updated = { ...order, ...result.order };
      setOrder(updated); localStorage.setItem("moyTaxiGeneralOrder", JSON.stringify(updated));
      if (updated.status === "cancelled") setNotice("Заказ отменён.");
    } catch (e) { setError(e.message || "Не удалось отменить заказ."); }
    finally { setBusy(false); }
  }
  async function priceAnswer(action, offerId) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await callApi(action, { order_id: order.id, client_token: order.client_token, offer_id: offerId });
      const updated = { ...order, ...result.order, offers: (order.offers || []).map(offer => offer.id === offerId ? { ...offer, status: action === "client_accept_offer" ? "accepted" : "declined" } : offer) };
      setOrder(updated); localStorage.setItem("moyTaxiGeneralOrder", JSON.stringify(updated));
      setNotice(action === "client_accept_offer" ? "Ты выбрал водителя. Он направляется к тебе." : "Предложение отклонено. Ищем другие варианты.");
    } catch (e) { setError(e.message || "Не удалось ответить на предложение."); }
    finally { setBusy(false); }
  }
  function newOrder() {
    localStorage.removeItem("moyTaxiGeneralOrder");
    setOrder(null); setRoute(null); setDestinationPoint(null); setPickupSuggestions([]); setDestinationSuggestions([]); setError(""); setNotice("");
  }
  function detectPickup() {
    if (!navigator.geolocation) {
      setLocating(false);
      setError("Геолокация недоступна в этом браузере. Можно указать адрес подачи вручную.");
      return;
    }
    pickupManuallyChosenRef.current = false;
    setLocating(true); setError(""); setNotice(""); setRoute(null);
    setPickupPoint(null); setPickup("Моё местоположение"); setPickupSuggestions([]);
    let finished = false;
    const onSuccess = position => {
      if (finished || pickupManuallyChosenRef.current) return;
      const point = { lat: Number(position?.coords?.latitude), lng: Number(position?.coords?.longitude) };
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
        finished = true;
        setPickupPoint(null); setLocating(false); setPickup("");
        setError("Телефон вернул некорректные координаты. Проверь GPS и попробуй снова.");
        return;
      }
      finished = true;
      setLocating(false);
      setPickupPoint(point); setPickup("Моё местоположение");
      callApi("address_reverse", point).then(result => {
        if (!pickupManuallyChosenRef.current) setPickup(result.label || "Моё местоположение");
      }).catch(() => {});
    };
    const onError = error => {
      if (finished) return;
      if (error?.code !== 1) {
        navigator.geolocation.getCurrentPosition(onSuccess, finalError => {
          if (finished) return;
          finished = true;
          setPickupPoint(null); setLocating(false); setPickup("");
          setError(gpsErrorMessage(finalError));
        }, { enableHighAccuracy: false, timeout: 30000, maximumAge: 300000 });
        return;
      }
      finished = true;
      setPickupPoint(null); setLocating(false); setPickup("");
      setError(gpsErrorMessage(error));
    };
    navigator.geolocation.getCurrentPosition(onSuccess, onError, { enableHighAccuracy: true, timeout: 25000, maximumAge: 120000 });
  }

  function swapRouteLocations() {
    const oldPickup = pickup;
    const oldDestination = destination;
    const oldPickupPoint = pickupPoint;
    const oldDestinationPoint = destinationPoint;
    setPickup(oldDestination);
    setDestination(oldPickup);
    setPickupPoint(oldDestinationPoint);
    setDestinationPoint(oldPickupPoint);
    pickupManuallyChosenRef.current = true;
    setPickupSuggestions([]);
    setDestinationSuggestions([]);
    setSuggestionError("");
    setRoute(null);
    setPriceAdjustment(0);
    setError("");
    setNotice("");
  }

  function scrollPassengerSection(id) {
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }

  return <main className="app client-app passenger-screen" id="passenger-home">
    <div className="passenger-map-stage" aria-label="Карта поездки">
      <RouteMap
        pickupPoint={pickupPoint || (order?.pickup_lat != null ? {lat:order.pickup_lat,lng:order.pickup_lng} : null)}
        destinationPoint={destinationPoint || (order?.destination_lat != null ? {lat:order.destination_lat,lng:order.destination_lng} : null)}
        routeGeometry={route?.geometry || order?.route_geometry || []}
        destinationInfo={route ? {timeText:Math.round(route.durationMin)+" мин",distanceText:Number(route.distanceKm).toLocaleString("ru-RU",{maximumFractionDigits:1})+" км"} : null}
        showZoomButtons={true}
      />
      <header className="passenger-topbar">
        <a href="/" className="passenger-top-icon" aria-label="На главный экран">‹</a>
        <a href="/" className="passenger-brand" aria-label="Мой Такси — главная">
          <span className="passenger-brand-pin" aria-hidden="true">
            <svg viewBox="0 0 48 48"><path d="M8 27l3-10c1-3 4-5 7-5h12c3 0 6 2 7 5l3 10 2 3v9h-5v-5H11v5H6V30z" fill="currentColor"/><path d="M14 25l2-8h16l2 8z" fill="#fff"/><circle cx="14" cy="30" r="2.5" fill="#f4bf16"/><circle cx="34" cy="30" r="2.5" fill="#f4bf16"/></svg>
          </span>
          <span>Мой <b>Такси</b></span>
        </a>
        <button type="button" className="passenger-top-icon passenger-gps-control" onClick={detectPickup} disabled={locating} aria-label="Определить моё местоположение" title="Моё местоположение">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="12" cy="12" r="7.4"/><circle cx="12" cy="12" r="2.3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
        </button>
      </header>
      <div className="passenger-map-caption"><span className="passenger-map-live-dot"></span>{pickupPoint ? "Местоположение определено" : locating ? "Определяем местоположение…" : "Карта Астаны"}</div>
    </div>

    <section className="passenger-sheet">
      <div className="passenger-sheet-handle" aria-hidden="true"></div>
      <div className="passenger-sheet-heading">
        <div><span className="passenger-eyebrow">{!showBooking ? "ВАША ПОЕЗДКА" : "ЗАКАЗ ТАКСИ"}</span><h1>{!showBooking ? (order.status === "new" ? "Ищем водителя" : order.status === "accepted" ? "Водитель едет к вам" : order.status === "arrived" ? "Водитель на месте" : order.status === "started" ? "Поездка началась" : statusLabel(order.status)) : "Куда едем?"}</h1></div>
        <span className="passenger-city-badge">Астана</span>
      </div>
      {error && <div className="error passenger-message" role="alert">{error}</div>}
      {notice && <div className={notice.startsWith("2ГИС временно") ? "error passenger-message" : "success passenger-message"} role="status">{notice}</div>}

      {!showBooking ? <section className="passenger-trip-view" id="passenger-trip-card">
        <div className="passenger-trip-status"><span className={"passenger-status-dot status-"+String(order.status||"new")}></span><b>{statusLabel(order.status)}</b><span className="passenger-status-fare">{money(order.agreed_price || order.client_price || order.driver_price)}</span></div>
        <div className="passenger-trip-route">
          <div className="passenger-route-line"><span className="passenger-location-dot pickup"></span><div><small>Откуда</small><b>{order.pickup_address}</b></div></div>
          <div className="passenger-route-line"><span className="passenger-location-dot destination"></span><div><small>Куда</small><b>{order.destination_address}</b></div></div>
        </div>
        <div className="passenger-trip-facts">
          <div><small>Тариф</small><b>{CLASSES.find(x=>x.id===order.vehicle_class)?.label || CLASSES.find(x=>x.id===driver?.vehicle_class)?.label || "Эконом"}</b></div>
          <div><small>Расстояние</small><b>{Number(order.route_distance_km)>0 ? Number(order.route_distance_km).toFixed(1)+" км" : "—"}</b></div>
          <div><small>Оплата</small><b>{order.payment_method==="kaspi_gold" ? "Kaspi перевод" : "Наличные"}</b></div>
          <div><small>Тип</small><b>{order.trip_type==="intercity" ? "Межгород" : "Город"}</b></div>
        </div>
        {driver?.name && <div className="passenger-driver-card"><div className="passenger-driver-avatar" aria-hidden="true">🚕</div><div className="passenger-driver-copy"><b>{driver.name}</b><span>{driver.car_model || "Автомобиль"}{driver.car_color ? " · "+driver.car_color : ""}{driver.car_plate ? " · "+driver.car_plate : ""}</span>{driver.phone && <a href={"tel:"+driver.phone}>{driver.phone}</a>}</div></div>}
        {order.status === "arrived" && <div className="searching-panel"><h3>Водитель на месте</h3><p className="muted">Водитель приехал за тобой. Нажми кнопку, когда подходишь к машине.</p><button className="button primary" disabled={busy} onClick={markClientReady}>👋 Я выхожу</button></div>}
        {order.status === "client_ready" && <div className="success"><b>Ты сообщил водителю, что выходишь.</b><p className="small" style={{margin:"5px 0 0"}}>Садись в автомобиль; водитель начнёт поездку после посадки.</p></div>}
        {order.status === "new" && <div className="searching-panel" id="passenger-offers"><div className="searching-pulse">⌕</div><h3>Ищем водителей</h3><p className="muted">Водители выбранного класса рядом получат заказ и смогут предложить свою цену.</p><p><b>Предложений: {(order.offers||[]).filter(offer=>offer.status==="pending").length}</b></p>
          {(order.offers||[]).filter(offer=>offer.status==="pending").map(offer=><article className="driver-offer-card" key={offer.id}><div className="order-top"><h3>{offer.drivers?.name||"Водитель"}</h3><span className="status">{CLASSES.find(x=>x.id===offer.drivers?.vehicle_class)?.label||"Водитель"}</span></div><p><b>{money(offer.price)}</b></p><p>{offer.drivers?.car_model||"Автомобиль"}{offer.drivers?.car_color ? " · "+offer.drivers.car_color : ""}{offer.drivers?.car_plate ? " · "+offer.drivers.car_plate : ""}</p>{offer.drivers?.phone&&<p><a href={"tel:"+offer.drivers.phone}>{offer.drivers.phone}</a></p>}<div className="actions"><button className="button primary" disabled={busy} onClick={()=>priceAnswer("client_accept_offer",offer.id)}>Принять</button><button className="button danger" disabled={busy} onClick={()=>priceAnswer("client_decline_offer",offer.id)}>Отклонить</button></div></article>)}
          <button className="button danger" disabled={busy} onClick={cancelOrder}>Отменить заказ</button></div>}
        {["accepted","arrived","started"].includes(order.status) && order.pickup_lat != null && order.destination_lat != null && <a className="button secondary passenger-map-link" href={routeUrl({lat:order.pickup_lat,lng:order.pickup_lng},{lat:order.destination_lat,lng:order.destination_lng})} target="_blank" rel="noreferrer">🗺️ Открыть маршрут в 2ГИС</a>}
        {["accepted","arrived","client_ready"].includes(order.status) && <div className="searching-panel"><p>Если планы изменились, можно отменить заказ до начала поездки.</p><button className="button danger" type="button" disabled={busy} onClick={cancelOrder}>Отменить заказ</button></div>}
        {order.status === "completed" && !order.rating?.id && <section className="panel rating-panel"><h2>Как прошла поездка?</h2><p className="muted">Оцени водителя — это поможет улучшать сервис.</p><div className="rating-stars" role="group" aria-label="Оценка от 1 до 5 звёзд">{[1,2,3,4,5].map(star=><button type="button" key={star} className={star<=ratingStars ? "rating-star active" : "rating-star"} aria-label={star+" из 5"} aria-pressed={ratingStars===star} onClick={()=>setRatingStars(star)}>★</button>)}</div><div className="field"><label>Комментарий (необязательно)</label><textarea maxLength={500} value={ratingComment} onChange={e=>setRatingComment(e.target.value)} placeholder="Что понравилось или что улучшить?" /></div><button className="button primary" disabled={savingRating} onClick={submitRating}>{savingRating ? "Сохраняем…" : "Отправить оценку"}</button></section>}
        {order.status === "completed" && order.rating?.id && <div className="success"><b>Спасибо за оценку!</b><p style={{margin:"5px 0 0"}}>{"★".repeat(order.rating.stars)}{"☆".repeat(5-order.rating.stars)}{order.rating.comment ? " · "+order.rating.comment : ""}</p></div>}
        {["completed","cancelled"].includes(order.status) && <button className="button primary" onClick={newOrder}>Заказать ещё раз</button>}
      </section> : <section className="passenger-booking-view" id="passenger-booking">
        <form onSubmit={event=>event.preventDefault()}>
          <div className="passenger-contact-block" id="passenger-contact-section">
            {showContactFields ? <div className="contact-fields"><div className="field"><label htmlFor="moy-taxi-client-name">Ваше имя</label><input id="moy-taxi-client-name" required maxLength={100} autoComplete="name" value={name} onChange={e=>setName(e.target.value)} placeholder="Как вас зовут?" /></div><div className="field"><label htmlFor="moy-taxi-client-phone">Телефон</label><input id="moy-taxi-client-phone" required type="tel" maxLength={40} autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+7 777 000 00 00" /></div></div> : (name.trim() && phone.trim() ? <button type="button" className="saved-contact passenger-saved-contact" onClick={()=>setShowContactFields(true)}><span className="passenger-saved-contact-person" aria-hidden="true">👤</span><span className="passenger-saved-contact-data"><b>{name}</b><small>{phone}</small></span><span className="passenger-contact-edit">Изменить</span></button> : null)}
          </div>

          <div className="passenger-route-inputs">
            <div className="field address-field passenger-address-field pickup-address-field">
              <div className="passenger-address-row">
                <span className="passenger-address-icon pickup" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="currentColor"/><circle cx="12" cy="12" r="3.3" fill="#fff"/></svg></span>
                <div className="passenger-address-content"><label htmlFor="pickupAddress">Откуда</label><input id="pickupAddress" required maxLength={300} value={pickup} onChange={e=>{const value=e.target.value;pickupManuallyChosenRef.current=true;setPickup(value);setPickupPoint(null);setPickupSuggestions([]);setRoute(null);setError("");setNotice("");}} onKeyDown={e=>{if(e.key==="Enter"&&pickupSuggestions.length){e.preventDefault();const item=pickupSuggestions[0];pickupManuallyChosenRef.current=true;setPickup(item.label);setPickupPoint({lat:Number(item.lat),lng:Number(item.lng)});setPickupSuggestions([]);setRoute(null);setError("");setNotice("");}}} placeholder="Моё местоположение или адрес" autoComplete="off" /></div>
                <button type="button" className="passenger-address-gps" onClick={detectPickup} disabled={locating} aria-label="Моё местоположение" title="Моё местоположение"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="7.2"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></button>
              </div>
              {pickupSuggestions.length>0&&<div className="address-suggestions">{pickupSuggestions.map((item,i)=><button type="button" className="address-suggestion" key={item.label+"-pickup-"+i} onClick={()=>{pickupManuallyChosenRef.current=true;setPickup(item.label);setPickupPoint({lat:Number(item.lat),lng:Number(item.lng)});setPickupSuggestions([]);setRoute(null);setError("");setNotice("");}}><b>{item.name}</b><span>{item.label}</span><small>{item.city}</small></button>)}</div>}
              <div className="pickup-address-actions"><span className="pickup-address-hint">{pickupPoint ? "Точка подачи выбрана" : pickup.trim().length>=3 ? "Выбери адрес из подсказок" : "Можно указать адрес вручную"}</span><button type="button" className="button secondary pickup-gps-button passenger-detect-button" onClick={detectPickup} disabled={locating}>{locating ? "Определяем GPS…" : "📍 Моё местоположение"}</button></div>
            </div>

            <div className="field address-field passenger-address-field destination-address-field">
              <div className="passenger-address-row">
                <span className="passenger-address-icon destination" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 22s8-7.3 8-13a8 8 0 1 0-16 0c0 5.7 8 13 8 13z" fill="currentColor"/><circle cx="12" cy="9" r="3" fill="#fff"/></svg></span>
                <div className="passenger-address-content"><label htmlFor="destinationAddress">Куда</label><input id="destinationAddress" required maxLength={300} value={destination} onChange={e=>{setDestination(e.target.value);setPriceAdjustment(0);setRoute(null);setDestinationPoint(null);setError("");setSuggestionError("");}} onKeyDown={e=>{if(e.key==="Enter"&&destinationSuggestions.length){e.preventDefault();const item=destinationSuggestions[0];setDestination(item.label);setDestinationPoint({lat:item.lat,lng:item.lng});setDestinationSuggestions([]);setSuggestionError("");setPriceAdjustment(0);setRoute(null);}}} placeholder="Адрес, улица или место" autoComplete="off" /></div>
              </div>
              {suggestionLoading && <p className="muted small passenger-address-feedback">🔎 Ищем адреса…</p>}
              {destinationSuggestions.length>0&&<div className="address-suggestions">{destinationSuggestions.map((item,i)=><button type="button" className="address-suggestion" key={item.label+"-"+i} onClick={()=>{setDestination(item.label);setDestinationPoint({lat:item.lat,lng:item.lng});setDestinationSuggestions([]);setSuggestionError("");setPriceAdjustment(0);setRoute(null);setError("");}}><b>{item.name}</b><span>{item.label}</span><small>{item.city}</small></button>)}</div>}
              {suggestionError && !suggestionLoading && <p className="muted small address-search-help passenger-address-feedback">{suggestionError}</p>}
            </div>
            <button type="button" className="passenger-route-swap" onClick={swapRouteLocations} aria-label="Поменять адреса местами" title="Поменять адреса местами"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4v16m0-16L3.5 7.5M7 4l3.5 3.5M17 20V4m0 16-3.5-3.5M17 20l3.5-3.5"/></svg></button>
          </div>

          {route && <div className="passenger-route-calculation">
            <div className="passenger-route-summary"><span className="passenger-route-summary-icon">↗</span><div><b>{route.distanceKm.toFixed(1)} км</b><span>около {route.durationMin} мин. в пути</span></div><a href={pickupPoint && destinationPoint ? routeUrl(pickupPoint,destinationPoint) : "#"} target="_blank" rel="noreferrer">2ГИС ↗</a></div>
          </div>}

          <section className="passenger-tariff-section" aria-label="Выбор тарифа">
            <div className="passenger-section-heading"><div><h2>Выберите тариф</h2></div><button type="button" className="passenger-tariff-info-trigger" aria-expanded={tariffInfoOpen} onClick={()=>setTariffInfoOpen(value=>!value)}>Подробнее о тарифах <span aria-hidden="true">ⓘ</span></button></div>
            {tariffInfoOpen && <div className="passenger-tariff-info">Стоимость рассчитывается по выбранному маршруту и классу автомобиля. После отправки заказа водитель может принять предложенную сумму или предложить встречную цену.</div>}
            <div className="passenger-tariff-scroller">
              {CLASSES.map(item=>{
                const estimated=route?.estimated_prices?.[item.id];
                const selected=selectedClass===item.id;
                return <button key={item.id} type="button" className={"passenger-tariff-card"+(selected?" selected":"")} onClick={()=>{setSelectedClass(item.id);setPriceAdjustment(0);}} aria-pressed={selected}>
                  <span className={"passenger-tariff-car passenger-car-"+item.id} aria-hidden="true"><img src={TARIFF_IMAGES[item.id]} alt="" loading="lazy" draggable="false" /></span>
                  <b className="passenger-tariff-name">{item.label}</b>
                  <strong className="passenger-tariff-price">{estimated ? money(selected && quote!=null ? quote : estimated) : "— ₸"}</strong>
                  {selected && <span className="passenger-tariff-selected-mark" aria-hidden="true">✓</span>}
                </button>;
              })}
            </div>
            {route && !onlineClasses.includes(selectedClass) && <p className="passenger-offline-note" role="status">Сейчас водители класса «{CLASSES.find(x=>x.id===selectedClass)?.label || "Эконом"}» не на линии. Заказ сохранится; водители увидят его, когда выйдут на линию.</p>}
          </section>

          <section className="passenger-price-section" aria-label="Предложенная цена">
            <div className="passenger-price-heading"><span className="passenger-price-icon" aria-hidden="true">₸</span><div><b>Предложите свою цену</b><small>Водители могут принять её или предложить свою</small></div></div>
            <div className="passenger-price-stepper">
              <button type="button" aria-label="Уменьшить цену на 50 тенге" onClick={()=>changeOfferPrice(-50)} disabled={busy || quote==null || quote<=50}>−</button>
              <strong>{quote!=null ? money(quote) : "— ₸"}</strong>
              <button type="button" aria-label="Увеличить цену на 50 тенге" onClick={()=>changeOfferPrice(50)} disabled={busy || quote==null}>+</button>
            </div>
            <p className="passenger-price-hint">{quote!=null ? "Меняй цену шагом 50 ₸" : "Цена появится после расчёта маршрута"}</p>
          </section>

          {route && <div className="passenger-options-row">
            <div className="passenger-option-card"><span aria-hidden="true">💳</span><div><small>Способ оплаты</small><b>{paymentMethod==="kaspi_gold" ? "Kaspi перевод" : "Наличные"}</b></div></div>
            <div className="passenger-payment-options"><button type="button" className={"passenger-payment-choice"+(paymentMethod==="cash"?" selected":"")} onClick={()=>setPaymentMethod("cash")} aria-pressed={paymentMethod==="cash"}>Наличные</button><button type="button" className={"passenger-payment-choice"+(paymentMethod==="kaspi_gold"?" selected":"")} onClick={()=>setPaymentMethod("kaspi_gold")} aria-pressed={paymentMethod==="kaspi_gold"}>Kaspi</button></div>
          </div>}

          <div className="passenger-comment-field">
            <label htmlFor="passenger-comment">Пожелания водителю <span>(необязательно)</span></label>
            <textarea id="passenger-comment" maxLength={500} value={comment} onChange={e=>setComment(e.target.value)} placeholder="Подъезд, ориентир или другие пожелания…" rows={2}/>
          </div>

          <div className="passenger-booking-actions">
            <button className="passenger-offer-button" type="button" onClick={()=>submitOrder("offer")} disabled={busy || !route || quote==null}>{busy ? "Подождите…" : <><span className="passenger-action-icon" aria-hidden="true">➤</span><span><b>Предложить цену</b><small>Отправить водителям</small></span></>}</button>
            <button className="passenger-fast-button" type="button" onClick={()=>submitOrder("fast")} disabled={busy || !route || baseQuote==null}>{busy ? "Подождите…" : <><span className="passenger-action-icon" aria-hidden="true">ϟ</span><span><b>Быстрый заказ</b><small>По расчётной цене</small></span></>}</button>
          </div>
          {testMode && <p className="passenger-test-note">Тестовый режим: списания не выполняются.</p>}
        </form>
      </section>}
    </section>

    <nav className="passenger-bottom-nav" aria-label="Меню пассажира">
      <a href="#passenger-home" className="passenger-nav-item active" aria-current="page"><span aria-hidden="true">⌂</span><b>Главная</b></a>
      <button type="button" className="passenger-nav-item" onClick={()=>{if(order?.id && order.status!=="cancelled") scrollPassengerSection("passenger-trip-card");else {setNotice("Здесь появится статус твоей поездки после оформления заказа.");scrollPassengerSection("passenger-booking");}}}><span aria-hidden="true">▤</span><b>Мои поездки</b></button>
      <button type="button" className="passenger-nav-item" onClick={()=>{if(order?.status==="new") scrollPassengerSection("passenger-offers");else {setNotice("Предложения и связь с водителем появятся после отправки заказа.");scrollPassengerSection("passenger-booking");}}}><span aria-hidden="true">♡</span><b>Чаты</b></button>
      <button type="button" className="passenger-nav-item" onClick={()=>{setShowContactFields(true);scrollPassengerSection("passenger-contact-section");}}><span aria-hidden="true">●</span><b>Профиль</b></button>
    </nav>
  </main>;
}
