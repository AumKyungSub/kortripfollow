import React from 'react'
import { useNavigate } from 'react-router-dom'
// Page css
import './RegionList.style.css'

const RegionList = ({item}) => {

  const navigate = useNavigate();
  const locationDetail = () => {
    navigate(`/location/${item?.id}`)
  }

  return (
    <>
            <div className='regionListCover' onClick={locationDetail}>
                <div className="regionImgCover">
                    <img src={item?.imgName+"3.jpg"} alt={item?.imgName+"3.jpg"} />
                </div>
                <div className="regionTextCover">
                    <p className="regionName">{item?.region}</p>
                    <h3 className="regionLocation">{item?.location}</h3>
                    <p className="regionText">{item?.explainTitle}</p>
                </div>
            </div>
    </>
  )
}

export default RegionList
