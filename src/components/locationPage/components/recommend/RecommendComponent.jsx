import React from 'react';

// Swiper API
import { Swiper, SwiperSlide } from 'swiper/react';
import { EffectCoverflow, Pagination } from 'swiper/modules';

///////////////////////////////////////////////
const RecommendComponent = ({ item }) => {
  if (!item || !item.gallery || item.gallery.length === 0) return null;
  
  return (
    <Swiper
      effect={'coverflow'}
      grabCursor={true}
      centeredSlides={true}
      slidesPerView={'auto'}
      loop={true}
      coverflowEffect={{
        rotate: 50,
        stretch: 0,
        depth: 100,
        modifier: 1,
        slideShadows: true,
      }}
      pagination={false}
      modules={[EffectCoverflow, Pagination]}
      className="mySwiper recommendSwiper"
    >
      {item?.gallery.map((imgSrc, idx) => (
        <SwiperSlide key={idx} className='recoSwiper'>
          <img src={item?.imgName+imgSrc+".jpg"} alt={item.location} />
        </SwiperSlide>
      ))}
    </Swiper>
  );
};
export default RecommendComponent;
